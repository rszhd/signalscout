#!/usr/bin/env node
/**
 * Prove that what `pnpm publish` would ship actually works, from outside the
 * workspace. US-154.
 *
 * Nothing in this repository imports the built packages. The `development`
 * export condition and the vitest alias both point at `src/`, so every test
 * and every `pnpm dev` runs the source, and a tarball missing a folder, or a
 * `workspace:*` that pnpm failed to rewrite, would pass the whole suite and
 * fail on the first `npm install` somebody else ran. This packs both
 * packages, installs the tarballs into an empty project in the system temp
 * directory, imports one name from each, and runs the pipeline's migrations
 * from there against a database it creates and drops.
 *
 * It runs in the `check` job on every pull request and again before the
 * release job publishes, and it spends nothing: no provider, no model.
 *
 *   pnpm release:verify              # needs a built workspace and a Postgres
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packages = ["engine", "pipeline"];
const license = readFileSync(join(root, "LICENSE"), "utf8");

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options })
    ?.toString()
    .trim();
}

function fail(message) {
  console.error(`\nrelease:verify — ${message}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "signalscout-packed-"));

try {
  // --- pack ------------------------------------------------------------------
  const tarballs = {};
  for (const name of packages) {
    const out = join(work, `${name}.tgz`);
    run("pnpm", ["pack", "--out", out], { cwd: join(root, "packages", name) });
    tarballs[name] = out;
  }

  // --- what is in them -------------------------------------------------------
  for (const name of packages) {
    const listing = run("tar", ["-tzf", tarballs[name]]).split("\n");
    const manifest = JSON.parse(run("tar", ["-xOzf", tarballs[name], "package/package.json"]));

    const tests = listing.filter((file) => /\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(file));
    if (tests.length > 0) fail(`${name} ships ${tests.length} test files, e.g. ${tests[0]}`);
    if (!listing.includes("package/dist/index.js")) fail(`${name} ships no dist/index.js`);
    if (!listing.includes("package/dist/index.d.ts")) fail(`${name} ships no dist/index.d.ts`);
    if (listing.some((file) => file.startsWith("package/src/"))) fail(`${name} ships src/`);

    // The FSL asks that every copy carry its terms (US-379). npm takes LICENSE
    // from the package folder, never from the repository root, so the folder
    // holds a copy and this checks the copy has not drifted.
    if (!listing.includes("package/LICENSE")) fail(`${name} ships no LICENSE`);
    if (run("tar", ["-xOzf", tarballs[name], "package/LICENSE"]) !== license.trim()) {
      fail(`${name} ships a LICENSE that differs from the repository's`);
    }

    // The `development` condition points at src, which is not in the tarball.
    // publishConfig replaces exports at pack time; this checks that it did.
    const conditions = JSON.stringify(manifest.exports);
    if (conditions.includes("development")) fail(`${name}'s exports still name src/`);

    if (manifest.private) fail(`${name} is still private`);
    if (manifest.publishConfig?.access !== "public") fail(`${name} is not public`);

    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:")) {
        fail(`${name} depends on ${dependency} at "${range}"; pnpm did not rewrite it`);
      }
    }
  }

  const pipeline = JSON.parse(run("tar", ["-xOzf", tarballs.pipeline, "package/package.json"]));
  const engineRange = pipeline.dependencies?.["@signalscout/engine"];
  if (!/^\d+\.\d+\.\d+$/.test(engineRange ?? "")) {
    fail(`pipeline depends on the engine at "${engineRange}", not an exact version`);
  }
  if (!run("tar", ["-tzf", tarballs.pipeline]).includes("package/drizzle/meta/_journal.json")) {
    fail("pipeline ships no migrations journal");
  }

  // --- install into an empty project ----------------------------------------
  // npm rather than pnpm, on purpose. The pipeline tarball depends on the
  // engine at an exact version the registry may not have yet — before the
  // first publish it never has — and npm satisfies that range from the engine
  // tarball installed beside it without asking the registry. pnpm's override
  // for the same case worked on one machine and asked the registry on the CI
  // runner, and a check that passes only where it was written is not a check.
  const project = join(work, "consumer");
  run("mkdir", ["-p", project]);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }, null, 2),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarballs.engine, tarballs.pipeline], {
    cwd: project,
    stdio: ["ignore", "inherit", "inherit"],
  });

  // --- use them ----------------------------------------------------------------
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) fail("set DATABASE_URL to a Postgres this can create a database on");

  const probe = `
    import { createClassifier, builtInSources } from "@signalscout/engine";
    import { pipelineMigrations, runMigrations } from "@signalscout/pipeline";
    import { createTestDatabase, insertMonitor } from "@signalscout/pipeline/testing";

    if (typeof createClassifier !== "function") throw new Error("engine: createClassifier is not a function");
    if (builtInSources.length === 0) throw new Error("engine: no built-in sources");
    if (typeof runMigrations !== "function") throw new Error("pipeline: runMigrations is not a function");

    // createTestDatabase makes a database and applies the pipeline's stream
    // from the tarball's own drizzle/ folder, which is the claim under test.
    const database = await createTestDatabase("packed");
    try {
      // A consumer's tests insert a monitor through the package. US-157.
      await insertMonitor(database);
      console.log("migrated " + database.name + " from " + pipelineMigrations.folder);
    } finally {
      await database.drop();
    }
  `;
  writeFileSync(join(project, "probe.mjs"), probe);
  const output = run("node", ["probe.mjs"], {
    cwd: project,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  console.log(output);
  if (!output.includes("/consumer/node_modules/@signalscout/pipeline/drizzle")) {
    fail(`migrations came from ${output}, not from the installed package`);
  }

  console.log("release:verify — both tarballs install and work outside the workspace");
} finally {
  rmSync(work, { recursive: true, force: true });
}
