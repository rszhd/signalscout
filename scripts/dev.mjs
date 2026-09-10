#!/usr/bin/env node
/**
 * `pnpm dev` on a clean checkout.
 *
 * One command has to do four things: make a .env, start Postgres, apply the
 * migrations, and run the three processes. A README step that everyone forgets
 * is a step that belongs in the script.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureEnvFile, readEnvFile } from "./init-env.mjs";

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

const envPath = `${root}.env`;

/**
 * The same bootstrap `pnpm setup` runs, so the two install paths cannot drift.
 *
 * A README step that everyone forgets is a step that belongs in the script,
 * and a step in one script and not the other is a difference nobody chose:
 * `AUTH_SECRET` was generated here and not for the Docker path, which is the
 * path a self-hoster takes.
 */
for (const note of ensureEnvFile(root)) console.log(note);

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
