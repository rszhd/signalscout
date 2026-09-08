#!/usr/bin/env node
/**
 * `pnpm dev` on a clean checkout.
 *
 * One command has to do four things: make a .env, start Postgres, apply the
 * migrations, and run the three processes. A README step that everyone forgets
 * is a step that belongs in the script.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

/** Read .env without a dependency. Only `KEY=value` lines, no expansion. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const envPath = `${root}.env`;

if (!existsSync(envPath)) {
  copyFileSync(`${root}.env.example`, envPath);
  console.log("Created .env from .env.example.");
}

/**
 * A session secret for this checkout, generated once.
 *
 * `.env.example` is committed, so it cannot carry one: a secret in git is a
 * secret every reader of this repository holds. Generated here instead, and
 * appended rather than replacing anything, so a value somebody already set
 * survives.
 *
 * The application refuses to start without it. Making a developer read that
 * error on their first `pnpm dev` teaches nothing they need on day one.
 */
if (!readEnvFile(envPath).AUTH_SECRET) {
  appendFileSync(envPath, `\nAUTH_SECRET=${randomBytes(32).toString("base64")}\n`);
  console.log("Generated AUTH_SECRET in .env.");
}

const env = {
  ...process.env,
  ...readEnvFile(envPath),
  // In development the worker is always its own process, so a restart of the
  // API does not restart the queue. `pnpm dev` starts three processes.
  WORKER_IN_PROCESS: "false",
  // Resolve @signalscout/core to its source through the "development" export
  // condition. Nothing has to be built first, and a change inside core
  // restarts the API and the worker with it.
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=development`.trim(),
};

console.log("Starting Postgres…");
await run("docker", ["compose", "up", "-d", "--wait", "postgres"]);

console.log("Applying migrations…");
await run("pnpm", ["--filter", "@signalscout/core", "migrate"], { env });

await run(
  "pnpm",
  [
    "exec",
    "concurrently",
    "--names",
    "api,web,worker",
    "--prefix-colors",
    "blue,magenta,green",
    "--kill-others",
    "pnpm --filter @signalscout/api dev",
    "pnpm --filter @signalscout/web dev",
    "pnpm --filter @signalscout/worker dev",
  ],
  { env },
);
