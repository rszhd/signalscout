#!/usr/bin/env node
/**
 * Remove a worktree made by `new-worktree.mjs`, and the Postgres that came with
 * it.
 *
 * `git worktree remove` deletes the folder and knows nothing about the
 * container, the network or the data volume beside it. Git has no hook for the
 * removal and an alias cannot shadow a built-in subcommand, so this is a
 * command to run in its place rather than something that wraps it. The next
 * `new-worktree.mjs` reports whatever a bare `git worktree remove` left behind,
 * so forgetting is visible rather than silent.
 *
 * **The branch is never deleted.** The folder and the database are a copy of
 * something else; the commits on the branch are not, and this is exactly the
 * moment somebody removes a worktree they thought was finished. The branch is
 * named on the way out instead. US-135.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./init-env.mjs";
import { removeProject, WORKTREE_DIR } from "./worktrees.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

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

async function main() {
  const name = process.argv[2];
  const force = process.argv.includes("--force");
  if (!name) {
    console.error("usage: node scripts/remove-worktree.mjs <name> [--force]");
    process.exit(1);
  }

  const mainCheckout = worktreePaths()[0];
  const target = resolve(mainCheckout, WORKTREE_DIR, name);
  if (!existsSync(target)) {
    console.error(`no worktree at ${target}`);
    process.exit(1);
  }

  const env = readEnvFile(`${target}/.env`);
  const project = env.COMPOSE_PROJECT_NAME;
  const branch = git(["-C", target, "rev-parse", "--abbrev-ref", "HEAD"]);

  if (project) {
    console.log(`Removing ${project}: its container, its network and its data volume…`);
    removeProject(project, target);
  } else {
    console.log(`${target}/.env names no COMPOSE_PROJECT_NAME. Removing the folder only.`);
  }

  console.log("Removing the worktree…");
  git(["worktree", "remove", ...(force ? ["--force"] : []), target], { stdio: "inherit" });

  console.log(`
Gone. The branch \`${branch}\` is kept — a folder and a copied database can be
made again, and the commits on a branch cannot. Delete it yourself when you are
sure:

  git branch -d ${branch}
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
