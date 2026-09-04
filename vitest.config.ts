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
    /**
     * No test reaches a model provider, so the suite runs with no key even on
     * a machine that has one exported. The worker builds no classifier without
     * one, and the classifier's own tests pass a stub model in. This makes
     * "no test spends money" a property of the setup rather than of the code
     * each test happens to call. docs/testing.md.
     */
    env: { AI_API_KEY: "", AI_PROVIDER: "anthropic" },
    // Files that create their own Postgres database pay for it in setup.
    hookTimeout: 60_000,
  },
});
