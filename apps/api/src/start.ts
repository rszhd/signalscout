import type { Env, Logger, WorkerHandle } from "@intentwatch/core";
import { startWorker as startWorkerDefault } from "@intentwatch/core";
import { type ApiServer, buildServer as buildServerDefault } from "./server.js";

export interface StartApiOptions {
  env: Env;
  logger: Logger;
  /** Injected in tests so no port is bound and no database is touched. */
  buildServer?: typeof buildServerDefault;
  startWorker?: typeof startWorkerDefault;
}

export interface ApiHandle {
  app: ApiServer;
  worker: WorkerHandle | null;
  stop: () => Promise<void>;
}

/**
 * Start the API, and the worker with it when WORKER_IN_PROCESS is true.
 *
 * The two modes share this one function. A separate worker container runs the
 * same `startWorker` from `apps/worker`, so "in process" and "own container"
 * differ in where the process boundary falls and in nothing else.
 */
export async function startApi({
  env,
  logger,
  buildServer = buildServerDefault,
  startWorker = startWorkerDefault,
}: StartApiOptions): Promise<ApiHandle> {
  const worker = env.WORKER_IN_PROCESS
    ? await startWorker({ databaseUrl: env.DATABASE_URL, logger })
    : null;

  if (!worker) {
    logger.info("WORKER_IN_PROCESS is false; expecting a separate worker container");
  }

  const app = await buildServer({ env, logger });
  await app.listen({ host: env.HOST, port: env.PORT });

  return {
    app,
    worker,
    stop: async () => {
      await app.close();
      await worker?.stop();
    },
  };
}
