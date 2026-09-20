#!/usr/bin/env node
/**
 * The packed `@signalscout/ui` installs and works outside the workspace.
 *
 * `verify-packed.mjs` does this for the engine and the pipeline. This is the
 * same act for the brand package, and it checks the two things `tsc` alone
 * cannot: that the stylesheets and canonical marks are in the tarball — a
 * build that was `tsc` and nothing else exports files that are not there —
 * and that `publishConfig` replaced the `development` condition, which points
 * at `src/` and would send a consumer to a folder the tarball omits.
 *
 * React is not installed here. The words and the labels are plain functions,
 * so importing the entry point proves the module graph resolves; a component
 * needs a renderer and is the browser's business, not this script's.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const problems = [];
const fail = (message) => problems.push(message);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

const work = mkdtempSync(join(tmpdir(), "signalscout-ui-packed-"));

try {
  const tarball = join(work, "ui.tgz");
  run("pnpm", ["pack", "--out", tarball], { cwd: join(root, "packages/ui") });

  const listing = run("tar", ["-tzf", tarball]).split("\n");
  const manifest = JSON.parse(run("tar", ["-xOzf", tarball, "package/package.json"]));

  for (const file of [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/testing/index.js",
    "package/dist/testing/harness.js",
    "package/dist/styles/tokens.css",
    "package/dist/styles/theme.css",
    "package/dist/styles/project-card.css",
    "package/dist/styles/reply-voices.css",
    "package/dist/styles/reply-draft.css",
    "package/dist/assets/mark.svg",
    "package/dist/assets/mark-small.svg",
  ]) {
    if (!listing.includes(file)) fail(`ships no ${file.replace("package/", "")}`);
  }

  // The harness renders and so needs react-dom; the words and the components do
  // not. A main entry that reached react-dom would make every consumer that
  // only wants a sentence pay for a renderer. US-274.
  const entry = run("tar", ["-xOzf", tarball, "package/dist/index.js"]);
  if (entry.includes("react-dom") || entry.includes("./testing")) {
    fail("dist/index.js reaches the harness or react-dom");
  }

  const tests = listing.filter((file) => /\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(file));
  if (tests.length > 0) fail(`ships ${tests.length} test files, e.g. ${tests[0]}`);
  if (listing.some((file) => file.startsWith("package/src/"))) fail("ships src/");

  if (JSON.stringify(manifest.exports).includes("development")) {
    fail("exports still name src/: publishConfig did not replace them");
  }
  if (manifest.private) fail("is still private");
  if (manifest.publishConfig?.access !== "public") fail("is not public");
  if (Object.keys(manifest.dependencies ?? {}).length > 0) {
    fail("has runtime dependencies; React is a peer");
  }
  if (!manifest.peerDependencies?.react) fail("does not name React as a peer");

  // --- install it somewhere else and use it ----------------------------------
  const project = join(work, "consumer");
  run("mkdir", ["-p", project]);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: project });

  writeFileSync(
    join(project, "use.mjs"),
    [
      'import { formatMicros, platformName, pollSummary } from "@signalscout/ui";',
      'import { readFileSync } from "node:fs";',
      'if (formatMicros(15_000) !== "$0.015") throw new Error("formatMicros");',
      'if (platformName("reddit") !== "Reddit") throw new Error("platformName");',
      'const run = { units: 0, outcome: "collected", postsReturned: 7, postsNew: 2, sources: [], stopReason: null };',
      'if (!pollSummary(run, { spend: false }).includes("7 posts")) throw new Error("pollSummary");',
      'const tokens = readFileSync("node_modules/@signalscout/ui/dist/styles/tokens.css", "utf8");',
      'if (!tokens.includes("--accent")) throw new Error("tokens.css");',
      'console.log("ok");',
    ].join("\n"),
  );
  const output = run("node", ["use.mjs"], { cwd: project });
  if (!output.includes("ok")) fail(`the consumer script printed ${JSON.stringify(output)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`@signalscout/ui ${problem}`);
  process.exit(1);
}

console.log("@signalscout/ui packs, installs and works outside the workspace.");
