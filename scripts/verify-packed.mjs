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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packages = ["engine", "pipeline"];

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
  const project = join(work, "consumer");
  writeFileSync(
    join(work, "consumer.package.json"),
    JSON.stringify(
      {
        name: "consumer",
        private: true,
        type: "module",
        dependencies: {
          "@signalscout/engine": `file:${tarballs.engine}`,
          "@signalscout/pipeline": `file:${tarballs.pipeline}`,
        },
        // The pipeline tarball asks the registry for the engine at an exact
        // version that may not be published yet. Point it at the tarball.
        pnpm: { overrides: { "@signalscout/engine": `file:${tarballs.engine}` } },
      },
      null,
      2,
    ),
  );
  run("mkdir", ["-p", project]);
  run("cp", [join(work, "consumer.package.json"), join(project, "package.json")]);
  run(
    "pnpm",
    ["install", "--prefer-offline", "--ignore-workspace", "--config.confirmModulesPurge=false"],
    {
      cwd: project,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  // --- use them ----------------------------------------------------------------
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) fail("set DATABASE_URL to a Postgres this can create a database on");

  const probe = `
    import { createClassifier, builtInSources } from "@signalscout/engine";
    import { pipelineMigrations, runMigrations } from "@signalscout/pipeline";
    import { createTestDatabase } from "@signalscout/pipeline/testing";

    if (typeof createClassifier !== "function") throw new Error("engine: createClassifier is not a function");
    if (builtInSources.length === 0) throw new Error("engine: no built-in sources");
    if (typeof runMigrations !== "function") throw new Error("pipeline: runMigrations is not a function");

    // createTestDatabase makes a database and applies the pipeline's stream
    // from the tarball's own drizzle/ folder, which is the claim under test.
    const database = await createTestDatabase("packed");
    try {
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
  if (!output.includes("/node_modules/@signalscout/pipeline/drizzle")) {
    fail(`migrations came from ${output}, not from the installed package`);
  }

  console.log("release:verify — both tarballs install and work outside the workspace");
} finally {
  rmSync(work, { recursive: true, force: true });
}
