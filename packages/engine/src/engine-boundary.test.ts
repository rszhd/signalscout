import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The definition of "stateless", said to CI. US-152.
 *
 * `packages/engine` is the half of the product two applications share and a
 * private repository builds on: connectors, model calls, the pre-filter, the
 * estimate and the cipher. Input in, result and cost out. Four things keep it
 * that way:
 *
 * 1. It declares none of the stateful dependencies. A database driver, a
 *    queue, an auth library or a payment provider in the engine is an app
 *    concern that leaked.
 * 2. No source file imports one of them either, however it is declared.
 * 3. No source file imports `packages/core`. The direction is core → engine,
 *    never back, or the two are one package with a folder between them.
 * 4. No source file reads `process.env`. A key, a model name or a base URL is
 *    an argument. A default parameter of `= process.env` counts as a read,
 *    because a caller who omits it has read the environment without saying so.
 *
 * The capture scripts are the one named exception to rule 4. They are
 * instruments run by hand — `pnpm capture:*` — and an entry point is exactly
 * where the environment is read. They ask a real model and write what it
 * answered beside the tests that replay it, so they live with the fixtures.
 *
 * `core-boundary.test.ts` is the model for the shape. The lists differ.
 */

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
/** This file names the forbidden read in order to look for it. */
const thisFile = fileURLToPath(import.meta.url);

const forbidden = [
  "pg",
  "drizzle-orm",
  "drizzle-kit",
  "pg-boss",
  "better-auth",
  "stripe",
  "nodemailer",
  "fastify",
  "@fastify/",
  "react",
  "react-dom",
  "react-router",
  "@signalscout/core",
  "@signalscout/api",
  "@signalscout/worker",
  "@signalscout/web",
];

function isForbidden(specifier: string): boolean {
  return forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** A relative import that climbs out of `src/` reaches another package. */
function leavesThePackage(specifier: string, file: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const from = join(file, "..");
  const target = join(from, specifier);
  return !target.startsWith(join(packageRoot, "src"));
}

/** Every `from "x"`, `import "x"` and `require("x")` in a file. */
function importedModules(source: string): string[] {
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  return patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""),
  );
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );

  return files.flat();
}

function isCaptureScript(file: string): boolean {
  return /\/fixtures\/capture[^/]*\.ts$/.test(file);
}

describe("packages/engine is stateless", () => {
  it("declares no database, queue, auth, payment or framework dependency", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];

    expect(declared.filter(isForbidden)).toEqual([]);
  });

  it("imports none of them, and nothing from another package, in any source file", async () => {
    const files = await sourceFiles(join(packageRoot, "src"));

    expect(files.length).toBeGreaterThan(0);

    const offences = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, "utf8");
          return importedModules(source)
            .filter((specifier) => isForbidden(specifier) || leavesThePackage(specifier, file))
            .map((specifier) => `${file.slice(packageRoot.length)} imports ${specifier}`);
        }),
      )
    ).flat();

    expect(offences).toEqual([]);
  });

  it("reads process.env in no source file but a capture script", async () => {
    const files = await sourceFiles(join(packageRoot, "src"));

    const offences = (
      await Promise.all(
        files
          .filter((file) => file !== thisFile && !isCaptureScript(file))
          .map(async (file) => {
            const source = await readFile(file, "utf8");
            return /\bprocess\.env\b/.test(source) ? [file.slice(packageRoot.length)] : [];
          }),
      )
    ).flat();

    expect(offences).toEqual([]);
  });
});
