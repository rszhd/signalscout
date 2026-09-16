/**
 * What `new-worktree.mjs` and `remove-worktree.mjs` both need to agree on.
 *
 * One slot is three ports and a compose project name, and both commands have to
 * derive them the same way — the one that creates a worktree and the one that
 * takes its database away. They live here rather than in either command,
 * because a command importing the other one is a cycle, and a constant copied
 * into both is a constant that drifts. The tests import this file. US-135.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

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

/**
 * A compose project this repository made, whose worktree is gone.
 *
 * The prefix is what keeps the main checkout and every unrelated project on the
 * machine out of it: `new-worktree.mjs` names every project `signalscout_…` and
 * the main one is `intentwatch`. A project that is still named by a live
 * worktree is never an orphan, whatever its state.
 */
export function orphanProjects(dockerProjects, liveProjects) {
  const live = new Set(liveProjects);
  return dockerProjects.filter((name) => name.startsWith("signalscout_") && !live.has(name));
}

/** Every compose project a worktree currently names, the main checkout included. */
export function liveProjectsFrom(envs) {
  return envs.map((env) => env.COMPOSE_PROJECT_NAME).filter(Boolean);
}

/** Compose projects on this machine, stopped ones included. */
export function dockerProjects() {
  try {
    const listed = execFileSync("docker", ["compose", "ls", "-a", "--format", "json"], {
      encoding: "utf8",
    });
    return JSON.parse(listed).map((project) => project.Name);
  } catch {
    return [];
  }
}

/** Remove a project's containers, its network and its data volume. */
export function removeProject(project, cwd) {
  execFileSync("docker", ["compose", "-p", project, "down", "-v"], { cwd, stdio: "inherit" });
}
