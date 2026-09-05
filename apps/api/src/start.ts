import type { Env, JobSender, Logger, WorkerHandle } from "@intentwatch/core";
import {
  assertStoredCredentialsAreReadable,
  createDatabase,
  credentialRecordName,
  jobSenderFor,
  listCredentialHints,
  startJobSender as startJobSenderDefault,
  startWorker as startWorkerDefault,
} from "@intentwatch/core";
import { type ApiServer, buildServer as buildServerDefault } from "./server.js";

export interface StartApiOptions {
  env: Env;
  logger: Logger;
  /** Injected in tests so no port is bound and no database is touched. */
  buildServer?: typeof buildServerDefault;
  startWorker?: typeof startWorkerDefault;
  startJobSender?: typeof startJobSenderDefault;
  createDatabase?: typeof createDatabase;
}

export interface ApiHandle {
  app: ApiServer;
  worker: WorkerHandle | null;
  /** How the cost test is handed to the worker. US-014. */
  jobs: JobSender;
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
  startJobSender = startJobSenderDefault,
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

  /**
   * The credential store, read once, before the first request.
   *
   * The check first: the API answers "is this source configured?", and a
   * stored credential it cannot decrypt would answer "no" — a wrong answer
   * that reads like a true one. Then the hints, which name which credentials
   * exist and never what they are.
   *
   * A snapshot, because the environment beside it is one too: a self-hoster
   * who edits `.env` restarts. Making one half live and the other stale would
   * be a worse answer than a consistent one. US-004.
   */
  let storedCredentials: ReadonlySet<string>;

  try {
    await assertStoredCredentialsAreReadable(db, { ENCRYPTION_KEY: env.ENCRYPTION_KEY });
    storedCredentials = new Set(
      (await listCredentialHints(db)).map((hint) => credentialRecordName(hint.source, hint.field)),
    );
  } catch (error) {
    await close();
    throw error;
  }

  /**
   * The queue the cost test is sent to.
   *
   * The worker's own when there is one in this process, and a connection of
   * our own when the worker is a separate container. One `pg-boss` fewer is
   * one fewer maintenance loop against the same database, so the shared case
   * is worth the branch.
   */
  const jobs = worker ? jobSenderFor(worker.boss) : await startJobSender(env.DATABASE_URL);

  const app = await buildServer({ env, logger, db, jobs, storedCredentials });
  await app.listen({ host: env.HOST, port: env.PORT });

  return {
    app,
    worker,
    jobs,
    stop: async () => {
      await app.close();
      // Before the worker: a sender that owns its connection has to close it,
      // and one that borrowed the worker's does nothing here.
      await jobs.stop();
      await worker?.stop();
      await close();
    },
  };
}
