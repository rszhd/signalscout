#!/usr/bin/env node
/**
 * What share of each file is comment, and how many lines name a ticket.
 *
 *   node scripts/comment-density.mjs              the twenty densest files
 *   node scripts/comment-density.mjs --all        every file
 *   node scripts/comment-density.mjs --json       for a diff between two runs
 *   node scripts/comment-density.mjs --blocks     every comment block over N lines
 *   node scripts/comment-density.mjs --min=25     with --blocks, the threshold
 *
 * A comment says what the code cannot: the constraint, the trap, the decision
 * that would otherwise be made twice. A measurement and a story about how the
 * code came to be both belong in the ticket's Log. This script does not know
 * which is which — a person reads the block and decides. It says where to
 * look, and it gives the next run something to compare against. US-302.
 *
 * It counts a line, not a token: a `//` or a `*` at the start of a line, and
 * the `/*` that opens a block. A trailing comment after code is not counted,
 * which understates the share and is the honest direction to be wrong in.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
};

const SKIP = new Set(["node_modules", "dist", "drizzle", "fixtures", ".git", "worktrees"]);
const CODE = /\.(ts|tsx|mjs)$/;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (CODE.test(entry.name) && statSync(path).isFile()) files.push(path);
  }
};
for (const dir of ["apps", "packages", "scripts", "evals"]) {
  try {
    walk(resolve(root, dir));
  } catch {
    // The folder is optional; a checkout without it measures the rest.
  }
}

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const TICKET = /\b(US|BUG)-\d+\b/;

const measured = files
  .map((path) => {
    const lines = readFileSync(path, "utf8").split("\n");
    const blocks = [];
    let run = 0;
    let comments = 0;
    let tickets = 0;
    lines.forEach((line, index) => {
      if (COMMENT.test(line)) {
        comments += 1;
        if (TICKET.test(line)) tickets += 1;
        run += 1;
        return;
      }
      if (run > 0) blocks.push({ start: index - run + 1, length: run });
      run = 0;
    });
    if (run > 0) blocks.push({ start: lines.length - run + 1, length: run });
    return {
      file: relative(root, path),
      lines: lines.length,
      comments,
      tickets,
      share: lines.length ? comments / lines.length : 0,
      blocks,
      test: /\.test\.(ts|tsx|mjs)$/.test(path),
    };
  })
  .sort((a, b) => b.comments - a.comments);

const total = (key) => measured.reduce((sum, file) => sum + file[key], 0);
const summary = {
  files: measured.length,
  lines: total("lines"),
  comments: total("comments"),
  share: total("comments") / total("lines"),
  ticketLines: total("tickets"),
  blocksOverMin: measured.flatMap((f) => f.blocks.filter((b) => b.length > value("min", 15)))
    .length,
};

if (has("--json")) {
  console.log(JSON.stringify({ summary, files: measured }, null, 2));
  process.exit(0);
}

if (has("--blocks")) {
  const min = value("min", 15);
  for (const file of measured) {
    for (const block of file.blocks.filter((b) => b.length > min)) {
      console.log(`${String(block.length).padStart(4)}  ${file.file}:${block.start}`);
    }
  }
  console.log(`\n${summary.blocksOverMin} block(s) over ${min} lines.`);
  process.exit(0);
}

const shown = has("--all") ? measured : measured.slice(0, 20);
console.log("  share  comments   lines  ticket lines  file");
for (const file of shown) {
  console.log(
    `${(file.share * 100).toFixed(0).padStart(6)}%${String(file.comments).padStart(10)}${String(file.lines).padStart(8)}${String(file.tickets).padStart(14)}  ${file.file}`,
  );
}
console.log(
  `\n${summary.files} files, ${summary.comments} comment lines of ${summary.lines} (${(summary.share * 100).toFixed(1)}%), ${summary.ticketLines} naming a ticket, ${summary.blocksOverMin} blocks over ${value("min", 15)} lines.`,
);
