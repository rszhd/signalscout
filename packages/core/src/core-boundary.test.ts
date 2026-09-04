import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The one architectural rule in this repository: `packages/core` imports
 * neither Fastify nor React. The API and the worker both call into core, so
 * the moment core knows about an HTTP framework or a renderer, the business
 * logic stops being testable without one.
 *
 * A lint rule says the same thing to an editor. This says it to CI.
 */

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const forbidden = ["fastify", "@fastify/", "react", "react-dom", "react-router"];

function isForbidden(specifier: string): boolean {
  return forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`));
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

describe("packages/core imports neither Fastify nor React", () => {
  it("declares neither as a dependency", async () => {
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

  it("imports neither in any source file", async () => {
    const files = await sourceFiles(join(packageRoot, "src"));

    expect(files.length).toBeGreaterThan(0);

    const offences = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, "utf8");
          return importedModules(source)
            .filter(isForbidden)
            .map((specifier) => `${file.slice(packageRoot.length)} imports ${specifier}`);
        }),
      )
    ).flat();

    expect(offences).toEqual([]);
  });
});
