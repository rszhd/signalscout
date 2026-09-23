/**
 * A hook pnpm runs on each package's manifest before it resolves the tree.
 * BUG-338.
 *
 * `better-auth` and its adapter packages declare an optional peer for every
 * framework, database and tool they can work with. pnpm resolves an optional
 * peer to whatever the workspace already has, so `vitest`, `drizzle-kit` and
 * the others were recorded as `better-auth`'s optional dependencies, and
 * `pnpm install --prod` — the image's runtime install — installed them: about
 * 80 MB of tools no process in the image runs, an MPL-licensed CSS compiler,
 * and an `esbuild` with a known hole.
 *
 * A deny list, not a keep list: these packages also declare peers they do
 * need, and removing one of those would break the login.
 */
const unusedPeers = new Set([
  "@lynx-js/react",
  "@prisma/client",
  "@sveltejs/kit",
  "@tanstack/react-start",
  "@tanstack/solid-start",
  "better-sqlite3",
  "drizzle-kit",
  "mongodb",
  "mysql2",
  "next",
  "prisma",
  "react",
  "react-dom",
  "solid-js",
  "svelte",
  "vitest",
  "vue",
]);

function readPackage(manifest) {
  if (manifest.name !== "better-auth" && !manifest.name?.startsWith("@better-auth/")) {
    return manifest;
  }

  for (const field of ["peerDependencies", "peerDependenciesMeta"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (unusedPeers.has(name)) delete manifest[field][name];
    }
  }

  return manifest;
}

module.exports = { hooks: { readPackage } };
