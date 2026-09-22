#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for one tag, for the GitHub Release.
 *
 *   node scripts/release-notes.mjs v0.13.1      # the engine and pipeline entry
 *   node scripts/release-notes.mjs ui-v0.1.0    # the UI package entry
 *
 * The heading is `## 0.13.1 — date` for the shared series and
 * `## @signalscout/ui — 0.1.0 — date` for the UI's. The body runs to the next
 * `## ` heading. A tag with no section exits 1 and says so, because a Release
 * with an empty body tells a watcher nothing and the changelog is what the
 * release step is for. US-293.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: release-notes.mjs <tag>");
  process.exit(2);
}

const ui = tag.startsWith("ui-v");
const version = tag.replace(/^(ui-)?v/, "");
const heading = ui ? `## @signalscout/ui — ${version} — ` : `## ${version} — `;

const changelog = readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((line) => line.startsWith(heading));
if (start === -1) {
  console.error(`CHANGELOG.md has no heading starting "${heading}" for ${tag}.`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end === -1) end = lines.length;

const body = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();
if (body === "") {
  console.error(`The ${tag} section of CHANGELOG.md is empty.`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
