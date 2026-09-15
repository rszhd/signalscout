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
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./init-env.mjs";
import {
  buildEnvFile,
  composeProjectName,
  dockerProjects,
  liveProjectsFrom,
  MAIN_SLOT,
  orphanProjects,
  PAUSE_MONITORS_SQL_PATH,
  pickSlot,
  portsForSlots,
  probeBusyPorts,
  slotPorts,
  usedSlotsFrom,
  WORKTREE_DIR,
} from "./worktrees.mjs";

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

/**
 * Say what a bare `git worktree remove` left behind.
 *
 * Git deletes the folder and knows nothing about the container, the network and
 * the data volume beside it, and it has no hook this could be attached to. So
 * the orphan is reported at the next sensible moment rather than removed here:
 * a volume is deleted on purpose, by `remove-worktree.mjs`, and never as a side
 * effect of making something else.
 */
function reportOrphans(envs) {
  const orphans = orphanProjects(dockerProjects(), liveProjectsFrom(envs));
  if (orphans.length === 0) return;

  console.log(`
${orphans.length} Postgres from a removed worktree is still on this machine:
${orphans.map((project) => `  ${project}`).join("\n")}
Remove each one with \`docker compose -p <name> down -v\`, or use
\`scripts/remove-worktree.mjs\` next time, which does it with the folder.
`);
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
  const paths = worktreePaths();
  const used = usedSlotsFrom(paths.map((path) => readEnvFile(`${path}/.env`)));
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

  reportOrphans(paths.map((path) => readEnvFile(`${path}/.env`)));
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
