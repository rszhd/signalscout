#!/usr/bin/env node
/**
 * Repair LinkedIn fixtures an older scrubber wrote. BUG-393.
 *
 * For a folder whose raw answers can no longer be read again: Apify deletes a
 * run's dataset after a few days, so the Apify capture's `--rescrub` cannot
 * reach the answers behind fixtures captured earlier. This rewrites each
 * answer file through `repairScrubbed`, which keeps every pseudonym already
 * there and replaces only what the older scrubber let through.
 *
 *     node packages/engine/src/sources/providers/repair-linkedin-fixtures.mjs <folder>
 *
 * It spends nothing and calls nobody. Read what it prints, and then the files.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repairScrubbed } from "./linkedin-scrubber.mjs";

/** Files that describe a capture rather than hold an answer. */
const records = new Set(["manifest.json", "ledger.json", "findings.json"]);

const folder = process.argv[2];

if (!folder) {
  console.error("Name the fixtures folder to repair.");
  process.exit(1);
}

for (const file of readdirSync(folder)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  if (records.has(file)) continue;

  const path = join(folder, file);
  const { repaired, replaced } = repairScrubbed(JSON.parse(readFileSync(path, "utf8")));

  if (replaced > 0) writeFileSync(path, `${JSON.stringify(repaired, null, 2)}\n`);
  console.log(`${file}: ${replaced} replaced`);
}
