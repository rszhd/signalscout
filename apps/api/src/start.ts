import type { Env, Logger, WorkerHandle } from "@intentwatch/core";
import { createDatabase, startWorker as startWorkerDefault } from "@intentwatch/core";
import { type ApiServer, buildServer as buildServerDefault } from "./server.js";

export interface StartApiOptions {
  env: Env;
  logger: Logger;
  /** Injected in tests so no port is bound and no database is touched. */
  buildServer?: typeof buildServerDefault;
  startWorker?: typeof startWorkerDefault;
  createDatabase?: typeof createDatabase;
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
  createDatabase: openDatabase = createDatabase,
}: StartApiOptions): Promise<ApiHandle> {
  const worker = env.WORKER_IN_PROCESS
    ? await startWorker({ databaseUrl: env.DATABASE_URL, logger })
    : null;

  if (!worker) {
    logger.info("WORKER_IN_PROCESS is false; expecting a separate worker container");
  }

  // The API's own pool, separate from the worker's. They have different
  // shapes of load — short reads against long jobs — and one pool shared
  // between them would let a slow poll hold connections a request is waiting
  // for. Nothing connects until the first query.
  const { db, close } = openDatabase(env.DATABASE_URL);

  const app = await buildServer({ env, logger, db });
  await app.listen({ host: env.HOST, port: env.PORT });

  return {
    app,
    worker,
    stop: async () => {
      await app.close();
      await worker?.stop();
      await close();
    },
  };
}
