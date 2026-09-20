import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The third architectural rule: `packages/ui` knows the brand and nothing
 * else. It holds no database, no queue, no HTTP framework, and neither of the
 * other two packages — so a colour change can never become a reason to
 * release the engine or the pipeline, and a screen cannot reach the database
 * through a button.
 *
 * React, `react-dom` and `react-router` are peer dependencies rather than
 * dependencies: both applications already hold each, and two Reacts in one
 * bundle is two renderers and a hook that throws, while two routers is two
 * histories. `ProjectCard` links with the router because a plain anchor would
 * reload the whole application on a click (US-273), and the test harness under
 * `./testing` renders, so it needs `react-dom` (US-274).
 *
 * A second rule, about values rather than imports: a control here uses a
 * token name and never a raw colour or a raw spacing value. `stylelint` says
 * that one, over `src/styles`.
 *
 * `engine-boundary.test.ts` and `pipeline-boundary.test.ts` are the others.
 */

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const forbidden = [
  "pg",
  "pg-boss",
  "drizzle-orm",
  "fastify",
  "@fastify/",
  "better-auth",
  "stripe",
  "@signalscout/engine",
  "@signalscout/pipeline",
  "@signalscout/api",
  "@signalscout/web",
];

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
      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
    }),
  );

  return files.flat();
}

async function manifest(): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
}

describe("packages/ui holds the brand and nothing else", () => {
  it("declares no database, no queue, no framework and neither other package", async () => {
    const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = await manifest();
    const declared = [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
      ...Object.keys(peerDependencies),
    ];

    // React, its renderer and the router are allowed, and only as peers.
    const peers = ["react", "react-dom", "react-router"];
    expect(declared.filter((name) => isForbidden(name) && !peers.includes(name))).toEqual([]);
  });

  it("takes React and the router as peers, never as dependencies", async () => {
    const { dependencies = {}, peerDependencies = {} } = await manifest();

    // Two Reacts in one bundle is two renderers and a hook that throws; two
    // routers is two histories, and a link that navigates the wrong one.
    expect(Object.keys(dependencies)).toEqual([]);
    expect(peerDependencies.react).toBeDefined();
    expect(peerDependencies["react-router"]).toBeDefined();
    // The harness under `./testing` renders, so it needs the renderer. US-274.
    expect(peerDependencies["react-dom"]).toBeDefined();
  });

  it("imports none of them in any source file", async () => {
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

  it("reads nothing from the process environment", async () => {
    // A package that read `process.env` would behave differently in the two
    // applications for a reason no screen could show. `import.meta.env.BASE_URL`
    // is the bundler's, and `BrandIcon` uses it to find the provider icons
    // each application serves from `public/brands`.
    //
    // The test files are not part of the check: this one names the forbidden
    // string in order to look for it, and nothing under test ships them.
    const files = (await sourceFiles(join(packageRoot, "src"))).filter(
      (file) => !file.includes(".test."),
    );

    const offences = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, "utf8");
          return source.includes("process.env") ? [file.slice(packageRoot.length)] : [];
        }),
      )
    ).flat();

    expect(offences).toEqual([]);
  });
});
