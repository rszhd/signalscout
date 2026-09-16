import { admitEveryone, createLogger, startWorker } from "@signalscout/pipeline";
import { loadEnv } from "./config/env.js";

/**
 * The worker as its own process — `node apps/api/dist/worker.js`. It runs the
 * same `startWorker` the API runs when WORKER_IN_PROCESS is true, so there is
 * one worker implementation. It lives in this package because what it needs
 * beyond the pipeline — the settings and the entitlement gate — is this
 * application's, and US-153 moved both here.
 *
 * Running both at once is a configuration mistake: refuse it rather than let
 * two pollers share a queue by accident.
 */
const env = loadEnv();

if (env.WORKER_IN_PROCESS) {
  throw new Error(
    "WORKER_IN_PROCESS is true, so the API already runs the worker. " +
      "Set WORKER_IN_PROCESS=false to run this process.",
  );
}

const logger = createLogger({ level: env.LOG_LEVEL, name: "worker" });
const handle = await startWorker({
  databaseUrl: env.DATABASE_URL,
  logger,
  // Everyone may poll. This application charges nobody. US-153.
  entitled: admitEveryone,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutting down");
    handle.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}
