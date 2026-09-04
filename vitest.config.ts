import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against core's source, so `pnpm test` needs no build first.
      "@intentwatch/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    environment: "node",
    // Files that create their own Postgres database pay for it in setup.
    hookTimeout: 60_000,
  },
});
