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
     * Four, and the number is bounded by contention rather than by cores.
     *
     * A test file holds its own pool and often a `pg-boss` one beside it, so
     * concurrency is limited by `max_connections` long before it is limited by
     * the sixteen CPUs here. Measured on 2026-09-06: six workers peak at 57
     * connections of the hundred and run in 39 seconds, and eight are no
     * faster because five worker files carry the whole run.
     *
     * **Six was tried and reverted.** It made `classify.test.ts` fail two runs
     * in four — a `until()` wait exceeding its twenty seconds under load, not
     * a broken assertion. Four runs in 41 seconds and passed three for three.
     * Two seconds is not worth a suite that cries wolf, and a flaky run costs
     * far more than it saves the moment somebody starts ignoring it.
     *
     * Set here rather than left to the caller, because the number that used to
     * be passed by hand was three, from before `DATABASE_POOL_SIZE` capped each
     * pool. A default that must be remembered on the command line is a default
     * nobody has.
     */
    maxWorkers: 4,
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
      /**
       * How often a worker looks for a job. pg-boss's own default is seconds,
       * and a pipeline test's cost is that wait rather than any work it does:
       * measured on 2026-09-06, the five worker files were 397 of the suite's
       * 435 seconds, each test taking four to six seconds to do milliseconds
       * of work. Half a second is pg-boss's floor.
       *
       * Nothing sets this in production, where a poll starting a second later
       * is a poll starting a second later, and a query per queue per second
       * against a working database is a real cost for no gain.
       */
      WORKER_POLLING_INTERVAL_SECONDS: "0.5",
    },
    // Files that create their own Postgres database pay for it in setup.
    hookTimeout: 60_000,
  },
});
