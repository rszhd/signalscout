import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against core's source, so `pnpm test` needs no build first.
      // The longer specifier is first: an alias is matched in order, and
      // "@intentwatch/core" is a prefix of "@intentwatch/core/testing".
      "@intentwatch/core/testing": fileURLToPath(
        new URL("./packages/core/src/testing/index.ts", import.meta.url),
      ),
      "@intentwatch/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}"],
    environment: "node",
    /**
     * No test reaches a model provider, so the suite runs with no key even on
     * a machine that has one exported. The worker builds no classifier without
     * one, and the classifier's own tests pass a stub model in. This makes
     * "no test spends money" a property of the setup rather than of the code
     * each test happens to call. docs/testing.md.
     *
     * The embedding key is blanked for the same reason and needs its own line:
     * US-008's embedder falls back to `AI_API_KEY` only when both providers
     * match, so `AI_EMBEDDING_API_KEY` is a second way a machine could pay for
     * a test run. Both blank, and the pre-filter runs its free stage.
     */
    env: {
      SMTP_HOST: "",
      SMTP_PASSWORD: "",
      WEBHOOK_SIGNING_SECRET: "",
      AI_API_KEY: "",
      AI_PROVIDER: "anthropic",
      AI_EMBEDDING_API_KEY: "",
      AI_EMBEDDING_PROVIDER: "",
      /**
       * Three connections per pool, because the suite is many small clients
       * and not one busy one.
       *
       * A database per test file, run in parallel, outruns Postgres
       * `max_connections` of 100 at the ten `pg` and `pg-boss` each default
       * to. The file that loses fails with "sorry, too many clients already",
       * which surfaces as an assertion on a 500 and reads like a flaky test.
       * It moves between runs and passes alone, which is the tell.
       *
       * Three rather than one: a test file may hold two databases at once, and
       * a pool of one deadlocks a caller that holds a connection while asking
       * for another. `db/client.ts` reads it.
       */
      DATABASE_POOL_SIZE: "3",
    },
    // Files that create their own Postgres database pay for it in setup.
    hookTimeout: 60_000,
  },
});
