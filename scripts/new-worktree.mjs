#!/usr/bin/env node
/**
 * Add a git worktree that runs the whole product on ports of its own.
 *
 * A worktree separates the files and nothing else. Two agents working in two
 * folders share one API port, one Vite port and one Postgres container, so the
 * second `pnpm dev` either fails on a taken port or succeeds and migrates the
 * first one's database. This gives each folder a slot: three ports and a
 * compose project name derived from one number, so an agent reading 3002 knows
 * it is slot 2 without looking anything up.
 *
 * The new database is a copy of the main one, not an empty one. An agent asked
 * to change the inbox needs an inbox, and a dump carries the schema, the data
 * and the table of applied migrations, so a migration written in the worktree
 * applies on top of it.
 *
 * **Every monitor in the copy is paused.** The copy carries real monitors, real
 * schedules and real provider keys. Left running, the worker starts with
 * `pnpm dev`, the scheduler finds a monitor due, and a real provider and a real
 * model are billed for a poll nobody asked for in a folder nobody is watching.
 * The budget guard bounds that spend; it does not prevent it. This is the one
 * step that must not be made optional. US-135.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./init-env.mjs";

/** The main checkout owns slot 0, and every default in the repository is its. */
export const MAIN_SLOT = 0;

/**
 * Worktrees live inside the checkout, not beside it.
 *
 * An editor opened on the main folder then lists every worktree as its own
 * repository in one source-control view, which is the whole reason to put a
 * working tree inside another one. `.gitignore` carries the matching line, so
 * the folder is not also untracked content of the repository it sits in.
 */
export const WORKTREE_DIR = "worktrees";

const BASE = { PORT: 3000, WEB_PORT: 5173, POSTGRES_PORT: 5432 };

/**
 * One slot is three ports. The offset is the slot itself, so the numbers stay
 * readable: slot 2 is 3002, 5175 and 5434.
 */
export function slotPorts(slot) {
  return {
    PORT: BASE.PORT + slot,
    WEB_PORT: BASE.WEB_PORT + slot,
    POSTGRES_PORT: BASE.POSTGRES_PORT + slot,
  };
}

/**
 * The lowest slot nobody holds and nothing else on the machine is listening on.
 *
 * Two questions, not one. A slot another worktree wrote in its `.env` is taken
 * even if its container is stopped, because starting that worktree must not
 * collide. And a slot whose ports are held by something outside this repository
 * is equally unusable — this machine already ran two unrelated projects on 5433
 * and 5434, and the worktree only found out when Docker refused to publish the
 * port, after the folder and its branch had been made.
 *
 * A removed worktree releases its number and the next call offers it again.
 * That is wanted — worktrees come and go all day — and it is why the container
 * and the volume must be removed with the worktree rather than left behind.
 */
export function pickSlot(usedSlots, busyPorts = new Set()) {
  const taken = new Set(usedSlots);
  for (let slot = MAIN_SLOT + 1; slot < 1000; slot += 1) {
    if (taken.has(slot)) continue;
    if (Object.values(slotPorts(slot)).some((port) => busyPorts.has(port))) continue;
    return slot;
  }
  throw new Error("no free worktree slot below 1000");
}

/** Every port a slot in `slots` would publish, for asking what is already busy. */
export function portsForSlots(slots) {
  return slots.flatMap((slot) => Object.values(slotPorts(slot)));
}

/**
 * Which of these ports something is already listening on.
 *
 * Asked by binding rather than by reading a tool's output, because the thing in
 * the way is usually Docker publishing a port for another project, and a bind
 * is the same question the Docker daemon is about to ask.
 */
export async function probeBusyPorts(ports) {
  const busy = new Set();

  await Promise.all(
    ports.map(
      (port) =>
        new Promise((resolve) => {
          const server = createServer();
          server.once("error", () => {
            busy.add(port);
            resolve();
          });
          server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
        }),
    ),
  );

  return busy;
}

/** Read the slot each worktree wrote into its own `.env`. */
export function usedSlotsFrom(envs) {
  return envs
    .map((env) => Number(env.SIGNALSCOUT_SLOT))
    .filter((slot) => Number.isInteger(slot) && slot > MAIN_SLOT);
}

/** Compose reads this from the folder's `.env`, and it beats `name:` in the file. */
export function composeProjectName(name) {
  return `signalscout_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
}

/**
 * The worktree's `.env`: the main one, with the slot's values appended.
 *
 * `ENCRYPTION_KEY` comes across unchanged and has to. The copied credentials
 * are ciphertext under it, and a fresh key would leave the connections screen
 * offering keys nobody can spend. docs/secrets.md.
 */
export function buildEnvFile(mainEnvText, { slot, name }) {
  const ports = slotPorts(slot);
  const main = parseEnvText(mainEnvText);
  const user = main.POSTGRES_USER ?? "intentwatch";
  const password = main.POSTGRES_PASSWORD ?? "intentwatch";
  const database = main.POSTGRES_DB ?? "intentwatch";

  const overrides = {
    SIGNALSCOUT_SLOT: String(slot),
    COMPOSE_PROJECT_NAME: composeProjectName(name),
    PORT: String(ports.PORT),
    WEB_PORT: String(ports.WEB_PORT),
    POSTGRES_PORT: String(ports.POSTGRES_PORT),
    DATABASE_URL: `postgres://${user}:${password}@localhost:${ports.POSTGRES_PORT}/${database}`,
  };

  const kept = mainEnvText
    .split("\n")
    .filter((line) => {
      const key = line.slice(0, Math.max(line.indexOf("="), 0));
      return !(key && key in overrides);
    })
    .join("\n")
    .replace(/\n*$/, "\n");

  const added = Object.entries(overrides)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return `${kept}
# Written by scripts/new-worktree.mjs. This worktree holds slot ${slot}: its own
# API port, its own Vite port, and its own Postgres container, network and data
# volume under COMPOSE_PROJECT_NAME. US-135.
${added}
`;
}

function parseEnvText(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

/**
 * The statement a copy is paused with, read from the file that also proves it.
 *
 * It lives in `scripts/pause-every-monitor.sql` rather than here because
 * `worker/copied-database.test.ts` runs the same text against real Postgres. A
 * statement written in two places is a statement that drifts, and the drift
 * would be discovered as a bill.
 */
export const PAUSE_MONITORS_SQL_PATH = fileURLToPath(
  new URL("./pause-every-monitor.sql", import.meta.url),
);

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * `execFileSync` returns null when the child's stdout is inherited rather than
 * captured, so the trim is guarded. Both callers are here: one reads the
 * worktree list, the other lets `git worktree add` print its own progress.
 */
function git(args, options = {}) {
  const output = execFileSync("git", args, { cwd: root, encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}

function worktreePaths() {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/**
 * The main checkout, which is always the first worktree git lists.
 *
 * Every new folder is placed under this one, so running the script inside a
 * worktree does not nest a worktree in a worktree. The database is copied from
 * here too: the main checkout is the one an operator actually uses, and a copy
 * of a copy would carry another worktree's paused monitors.
 */
function mainCheckout() {
  return worktreePaths()[0];
}

function compose(project, args, options = {}) {
  return execFileSync("docker", ["compose", "-p", project, ...args], {
    encoding: "utf8",
    ...options,
  });
}

/**
 * Let an editor opened on the main folder list the worktrees under it.
 *
 * VS Code finds repositories in subfolders, but only one level down by
 * default, and `worktrees/<name>` is two. Without this the folder a person
 * opens shows one repository and the point of nesting is lost.
 *
 * Written into the main checkout's own `.vscode/settings.json`, which
 * `.gitignore` excludes. That is deliberate: this is a setting about where one
 * person keeps their folders, not a decision the repository makes for
 * everybody. Anything already in the file is kept.
 */
function ensureEditorSeesWorktrees(main) {
  const path = `${main}/.vscode/settings.json`;
  const wanted = { "git.repositoryScanMaxDepth": 2, "git.autoRepositoryDetection": true };

  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      console.log(
        `Leaving ${path} alone — it is not plain JSON. Set git.repositoryScanMaxDepth to 2 by hand.`,
      );
      return;
    }
  }

  if (Object.entries(wanted).every(([key, value]) => settings[key] === value)) return;

  mkdirSync(`${main}/.vscode`, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...settings, ...wanted }, null, 2)}\n`);
  console.log(`Set git.repositoryScanMaxDepth in ${path}, so the editor lists every worktree.`);
}

async function main() {
  const name = process.argv[2];
  /**
   * The branch the worktree starts from. `dev` is where work starts here, and
   * the argument exists for the case that branch cannot serve: a change to the
   * compose file or to this script is not in `dev` yet, so a worktree cut from
   * `dev` would not have it and could not be used to try it.
   */
  const base = process.argv[3] ?? "dev";
  if (!name) {
    console.error("usage: node scripts/new-worktree.mjs <name> [base-branch]");
    process.exit(1);
  }

  const main = mainCheckout();
  const mainEnvPath = `${main}/.env`;
  if (!existsSync(mainEnvPath)) {
    console.error(`no ${mainEnvPath}. Run \`pnpm setup\` in the main checkout first.`);
    process.exit(1);
  }

  const target = resolve(main, WORKTREE_DIR, name);
  const used = usedSlotsFrom(worktreePaths().map((path) => readEnvFile(`${path}/.env`)));
  const candidates = Array.from({ length: 64 }, (_, index) => MAIN_SLOT + 1 + index);
  const slot = pickSlot(used, await probeBusyPorts(portsForSlots(candidates)));
  const ports = slotPorts(slot);
  const project = composeProjectName(name);
  const mainEnv = readEnvFile(mainEnvPath);
  const mainProject = mainEnv.COMPOSE_PROJECT_NAME ?? "intentwatch";
  if (existsSync(target)) {
    console.error(`${target} already exists.`);
    process.exit(1);
  }

  console.log(
    `Slot ${slot}: API ${ports.PORT}, web ${ports.WEB_PORT}, Postgres ${ports.POSTGRES_PORT}`,
  );

  console.log(`Adding the worktree at ${target}, from ${base}…`);
  git(["worktree", "add", "-b", name, target, base], { stdio: "inherit" });

  ensureEditorSeesWorktrees(main);

  console.log("Writing .env…");
  writeFileSync(`${target}/.env`, buildEnvFile(readFileSync(mainEnvPath, "utf8"), { slot, name }));

  console.log("Installing dependencies…");
  execFileSync("pnpm", ["install"], { cwd: target, stdio: "inherit" });

  console.log("Starting Postgres…");
  execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres"], {
    cwd: target,
    stdio: "inherit",
  });

  console.log("Copying the database…");
  const user = mainEnv.POSTGRES_USER ?? "intentwatch";
  const database = mainEnv.POSTGRES_DB ?? "intentwatch";
  const dump = compose(mainProject, ["exec", "-T", "postgres", "pg_dump", "-U", user, database], {
    cwd: main,
    maxBuffer: 1024 * 1024 * 512,
  });
  compose(project, ["exec", "-T", "postgres", "psql", "-q", "-U", user, database], {
    cwd: target,
    input: dump,
    maxBuffer: 1024 * 1024 * 512,
  });

  console.log("Pausing every monitor in the copy…");
  compose(
    project,
    ["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", user, database],
    {
      cwd: target,
      input: readFileSync(PAUSE_MONITORS_SQL_PATH, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );

  console.log(`
Ready. The copy holds your data and your keys, and every monitor in it is
paused, so nothing polls and nothing is billed until you unpause one.

  cd ${target} && pnpm dev     # API ${ports.PORT}, UI http://localhost:${ports.WEB_PORT}

It sits inside the main checkout, so opening ${main} in the editor lists it in
the source-control view beside every other worktree.
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
