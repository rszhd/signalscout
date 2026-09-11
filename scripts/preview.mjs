#!/usr/bin/env node
/**
 * `pnpm preview` — the dev app on a link you can open from anywhere.
 *
 * Written for one situation: the person reviewing a screen is not at this
 * machine, and the app answers only on localhost. Pushing to `staging` works
 * and takes four to five minutes, because it builds an image and waits for
 * CI. This takes about ten seconds and hot reloads, at the cost of being
 * disposable and trusted less. US-118.
 *
 * The chain:
 *
 *   phone → Cloudflare → cloudflared → the proxy → Vite (and the API)
 *
 * Every leg over a network is encrypted. Cloudflare decrypts at its edge, so
 * it can read the traffic there — which is why this is for looking at screens
 * and staging is for anything real.
 *
 * No worker is started. A poll spends money at a real provider, and a window
 * onto the UI has no reason to start one.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The address Cloudflare assigned, read out of the tunnel's own log.
 *
 * The one piece of parsing here, and parsing someone else's output is the part
 * most likely to break when they change it without telling anybody.
 */
export function tunnelUrlFrom(log) {
  return log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
}

/**
 * A password for the site lock.
 *
 * Base64 minus the characters that go wrong when a person reads them off one
 * screen and types them into a phone, and minus the ones a shell would claim.
 */
export function makePassword() {
  return randomBytes(18).toString("base64").replace(/[/+=]/g, "").slice(0, 14);
}

/**
 * Which of these ports something else already holds.
 *
 * Asked before anything starts. Without it the first sign of a second preview
 * is an EADDRINUSE stack from whichever process lost the race, printed after
 * Postgres, the migrations and a tunnel have already run — and the tunnel is
 * then left behind, because the crash skips the stop.
 */
export async function portsInUse(ports) {
  const taken = [];

  for (const port of ports) {
    const free = await new Promise((resolve) => {
      const probe = createServer();

      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });

    if (!free) taken.push(port);
  }

  return taken;
}

/**
 * Stop everything this script started, then leave.
 *
 * `cleanup` is set once there is anything to clean. Children run in their own
 * process groups and are detached, so a parent that exits without this leaves
 * a tunnel and two servers behind — which is how three orphaned tunnels
 * accumulated on 2026-09-11 from three failed starts.
 */
let cleanup = null;

async function fail(message) {
  // Never returns. Every call site awaits it, or the script carries on and
  // announces a preview it does not have — which it did, once, printing `null`
  // as the address.
  console.error(`\n${message}\n`);
  if (cleanup) await cleanup();
  process.exit(1);
}

async function main() {
  // Imported here rather than at the top so that importing this file for its
  // two helpers — which the tests do — starts no server.
  const { readEnvFile } = await import("./init-env.mjs");
  const { startProxy } = await import("./preview-proxy.mjs");

  const PROXY_PORT = Number(process.env.PREVIEW_PROXY_PORT ?? 3099);
  const API_PORT = Number(process.env.PREVIEW_API_PORT ?? 3100);
  const VITE_PORT = Number(process.env.PREVIEW_VITE_PORT ?? 5174);
  const USER = process.env.PREVIEW_USER ?? "preview";

  const children = [];
  let stopProxy = null;
  let stopping = false;

  /**
   * Take down everything this run started.
   *
   * Defined before the first child, and installed as `cleanup` straight away,
   * so a failure part-way through — a port taken, a tunnel that never reported
   * an address — leaves nothing behind. Every child is detached, so nothing
   * here happens by itself.
   */
  async function stopEverything() {
    if (stopping) return;
    stopping = true;

    if (stopProxy) await stopProxy();
    for (const child of children) signalGroup(child, "SIGTERM");

    // Asked politely first, because the tunnel closes its connection to
    // Cloudflare on the way out rather than being timed out. Then insisted,
    // because a preview that leaves a port held is a preview that will not
    // start next time.
    await wait(1500);
    for (const child of children) signalGroup(child, "SIGKILL");
  }

  cleanup = stopEverything;

  /**
   * Start a child in its own process group.
   *
   * `detached` is the whole of it. `pnpm` spawns `sh`, which spawns `tsx` or
   * `vite`, so a signal sent to the child this returns reaches the wrapper and
   * not the server holding the port. Its own group makes the whole tree
   * killable in one call, and Ctrl-C then behaves the same as `kill`.
   */
  function start(command, args, options = {}) {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      detached: true,
      ...options,
    });

    children.push(child);
    child.on("error", (error) => void fail(`${command} could not start: ${error.message}`));
    return child;
  }

  function signalGroup(child, signal) {
    if (child.pid === undefined || child.exitCode !== null) return;

    try {
      process.kill(-child.pid, signal);
    } catch {
      // Already gone, which is the outcome asked for.
    }
  }

  function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
      );
    });
  }

  // A script that downloads a binary by itself is a script nobody reads before
  // running. Say what to run, and stop.
  const cloudflared = process.env.CLOUDFLARED ?? "cloudflared";

  try {
    await run(cloudflared, ["--version"], { stdio: "ignore" });
  } catch {
    await fail(
      `\`${cloudflared}\` is not installed. One binary, no root and no account:\n\n` +
        "  curl -sSL -o ~/.local/bin/cloudflared \\\n" +
        "    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64\n" +
        "  chmod +x ~/.local/bin/cloudflared\n\n" +
        "Other platforms: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
  }

  // `.env` is read before anything starts, so `PREVIEW_PASS` can be set there
  // once and the link keeps the same password every run. The shell wins over
  // the file for this one setting, which is the opposite of `baseEnv` below:
  // a value typed in front of the command is a deliberate override for this
  // run, and it should not lose to a line somebody wrote a month ago.
  const fileEnv = readEnvFile(`${root}.env`);
  const password = process.env.PREVIEW_PASS ?? fileEnv.PREVIEW_PASS ?? makePassword();

  const taken = await portsInUse([PROXY_PORT, API_PORT, VITE_PORT]);

  if (taken.length > 0) {
    await fail(
      `Already in use: ${taken.join(", ")}.\n\n` +
        "A preview is probably running already — its own terminal stops it with Ctrl-C.\n" +
        "If nothing of yours is there, something else holds the port:\n\n" +
        `  ss -lntp | grep -E ':(${[PROXY_PORT, API_PORT, VITE_PORT].join("|")})'\n\n` +
        "Or move this run: PREVIEW_PROXY_PORT, PREVIEW_API_PORT, PREVIEW_VITE_PORT.",
    );
  }

  console.log("Starting Postgres…");
  await run("docker", ["compose", "up", "-d", "--wait", "postgres"]);

  const baseEnv = { ...process.env, ...fileEnv };

  console.log("Applying migrations…");
  await run("pnpm", ["--filter", "@signalscout/core", "migrate"], { env: baseEnv });

  // The tunnel first: its address is an input to the API, which has to be told
  // the origin Better Auth will see.
  console.log("Opening the tunnel…");
  const logPath = join(await mkdtemp(join(tmpdir(), "signalscout-preview-")), "tunnel.log");
  // A descriptor, not a stream. `createWriteStream` opens the file later, so
  // at this point its `fd` is still null and `spawn` refuses it.
  const log = await open(logPath, "w");

  const tunnel = start(
    cloudflared,
    ["tunnel", "--url", `http://127.0.0.1:${PROXY_PORT}`, "--no-autoupdate"],
    { stdio: ["ignore", log.fd, log.fd] },
  );

  let url = null;
  for (let attempt = 0; attempt < 40 && url === null; attempt += 1) {
    await wait(500);
    url = tunnelUrlFrom(await readFile(logPath, "utf8"));
  }

  if (url === null) await fail(`The tunnel did not report an address. Its log: ${logPath}`);

  const env = {
    ...baseEnv,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    // No worker, in this process or beside it. A preview does not poll.
    WORKER_IN_PROCESS: "false",
    // Better Auth signs and checks against the address the browser used.
    AUTH_URL: url,
    APP_URL: url,
    AUTH_TRUSTED_ORIGINS: url,
    // The address is public, whatever `.env` says. Nobody who finds it registers.
    AUTH_SIGNUP: "closed",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=development`.trim(),
  };

  /**
   * The binaries, not `pnpm --filter` and not the packages' `dev` scripts.
   *
   * Two reasons, both found by using this. `pnpm` reports a child it did not
   * stop itself as a failure, so a clean Ctrl-C printed
   * `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` and a SIGTERM line — an error message
   * for the thing working correctly. And the API's `dev` script is `tsx watch`,
   * whose restart puts the server in a process group of its own, which the stop
   * cannot reach: after one edit, Ctrl-C left an API holding 3100 and the next
   * run could not start.
   *
   * So: no watcher on the API — Vite gives the hot reload this exists for, and
   * an API change means restarting this command — and two fewer wrapper
   * processes between here and the servers.
   */
  start(join(root, "node_modules/.bin/tsx"), ["apps/api/src/index.ts"], { env });
  start(
    join(root, "apps/web/node_modules/.bin/vite"),
    ["--port", String(VITE_PORT), "--strictPort"],
    {
      cwd: join(root, "apps/web"),
      env,
    },
  );

  try {
    stopProxy = await startProxy({
      port: PROXY_PORT,
      apiPort: API_PORT,
      vitePort: VITE_PORT,
      user: USER,
      password,
    });
  } catch (error) {
    // The preflight checked this port, so reaching here means something took
    // it in the seconds since. Say which, and take the tunnel down with us.
    await fail(`The proxy could not listen on ${PROXY_PORT}: ${error.message}`);
  }

  console.log(
    [
      "",
      "  Preview is live:",
      "",
      `    ${url}`,
      `    user:     ${USER}`,
      `    password: ${password}`,
      "",
      "  The browser asks for that password, then the app asks for your account.",
      "  Registration is closed on this process whatever .env says.",
      "",
      "  Cloudflare can read this traffic at its edge. Use staging for anything real.",
      "  Ctrl-C stops everything.",
      "",
    ].join("\n"),
  );

  async function stop() {
    await stopEverything();
    await log.close();
    process.exit(0);
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  tunnel.on("exit", () => {
    if (!stopping) void fail("The tunnel closed.");
  });
}

// Importing this file must start nothing. The tests import it for the two
// helpers above, and a `pnpm test` that opened a tunnel would be a surprise
// nobody asked for.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
