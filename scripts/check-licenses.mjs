#!/usr/bin/env node
/**
 * Are the dependencies' licenses compatible with ours? US-019.
 *
 * A command rather than a paragraph, because the answer changes every time
 * somebody adds a dependency and a paragraph does not. It reads what pnpm
 * reports for the production tree and fails when it meets a license that is
 * not on the allowed list.
 *
 * **The list is allow, not deny.** A deny list is a guess about which licenses
 * exist; an allow list is a statement about which ones have been read. A new
 * license fails this check and somebody looks at it, which is the point.
 *
 *     node scripts/check-licenses.mjs
 *
 * Apache-2.0 is our license, and it is permissive: it can take code under any
 * of the licenses below. What it cannot take is copyleft — GPL, LGPL, AGPL,
 * SSPL — because those would impose terms on everyone who receives this
 * software. That is the failure this guards against, and on 2026-09-06 the
 * production tree contained none.
 */
import { execFileSync } from "node:child_process";

/**
 * Licenses read and accepted, with what each one asks of us.
 *
 * Every permissive license here wants its own notice preserved in copies of
 * *that* dependency, which is a packaging concern for a distributed binary and
 * not for a repository people clone.
 */
const allowed = new Map([
  ["MIT", "permissive, attribution"],
  ["MIT-0", "permissive, no attribution required"],
  ["Apache-2.0", "permissive, attribution, express patent grant"],
  ["ISC", "permissive, attribution"],
  ["BSD-2-Clause", "permissive, attribution"],
  ["BSD-3-Clause", "permissive, attribution, no endorsement"],
  ["0BSD", "public-domain equivalent"],
  ["Unlicense", "public-domain equivalent"],
  ["CC0-1.0", "public-domain equivalent"],
  ["BlueOak-1.0.0", "permissive, plain-language"],
  ["OFL-1.1", "a font license; reserved-name clause, no code impact"],
  ["Python-2.0", "permissive, attribution"],
  ["(AFL-2.1 OR BSD-3-Clause)", "either arm is permissive"],
  ["(MIT OR CC0-1.0)", "either arm is permissive"],
]);

const report = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }),
);

const unknown = new Map();
let packages = 0;

for (const [license, entries] of Object.entries(report)) {
  const count = Array.isArray(entries) ? entries.length : 0;
  packages += count;

  if (allowed.has(license)) continue;

  unknown.set(
    license,
    (Array.isArray(entries) ? entries : []).map((entry) => entry.name ?? "(unnamed)").slice(0, 8),
  );
}

console.log(`Checked ${packages} production packages against our Apache-2.0.`);

for (const [license, entries] of Object.entries(report)) {
  if (!allowed.has(license)) continue;
  const count = Array.isArray(entries) ? entries.length : 0;
  console.log(`  ${String(count).padStart(3)}  ${license.padEnd(26)} ${allowed.get(license)}`);
}

if (unknown.size === 0) {
  console.log("\nEvery license is one we have read and accepted.");
  process.exit(0);
}

console.error("\nLicenses nobody here has read:");
for (const [license, names] of unknown) {
  console.error(`  ${license}: ${names.join(", ")}`);
}
console.error(
  "\nRead it, decide, and add it to `allowed` in this file with what it asks of us —" +
    "\nor drop the dependency. A copyleft license (GPL, LGPL, AGPL, SSPL) would impose" +
    "\nits terms on everyone who receives this software, and is the reason this runs.",
);
process.exit(1);
