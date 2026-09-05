import type { Env, JobSender, Logger, WorkerHandle } from "@intentwatch/core";
import {
  assertStoredCredentialsAreReadable,
  builtInSources,
  createDatabase,
  jobSenderFor,
  startBlockers,
  startJobSender as startJobSenderDefault,
  startWorker as startWorkerDefault,
  storedCredentialNames,
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
   * The credential store, checked before the first request.
   *
   * The API answers "is this source configured?", and a stored credential it
   * cannot decrypt would answer "no" — a wrong answer that reads like a true
   * one. So every row is decrypted here, and a key that cannot open one stops
   * the process. US-004.
   *
   * Which credentials exist is *not* snapshotted here any more. US-004's
   * reasoning was that the environment beside it is a snapshot too, so a
   * consistent stale answer beat a mixed one. US-023 made that wrong: the
   * connections screen writes a credential into this running process, and a
   * set taken here would go on reporting it missing until a restart. The
   * environment half is still read at boot, because changing it still means
   * editing a file and restarting.
   */
  try {
    await assertStoredCredentialsAreReadable(db, { ENCRYPTION_KEY: env.ENCRYPTION_KEY });
  } catch (error) {
    await close();
    throw error;
  }

  /**
   * What this deployment cannot poll, said once at boot.
   *
   * Here rather than beside the routes, and US-023 moved it. A source's
   * readiness now depends on the credential store, so asking the question
   * where the routes are registered would make registering a route a database
   * query — and `buildServer` is called by tests that never open a connection.
   * Boot is where the database is already known to be reachable, because the
   * check above just read every row of it.
   */
  const configured = await storedCredentialNames(db);
  const unconfigured = builtInSources.filter(
    (source) =>
      startBlockers([source.platform.id], {
        descriptors: builtInSources,
        storedCredentials: configured,
      }).length > 0,
  );

  if (unconfigured.length > 0) {
    logger.warn(
      {
        sources: unconfigured.map((source) => source.platform.id),
        providers: [...new Set(unconfigured.map((source) => source.provider.id))],
      },
      "some sources have no credentials; monitors that name them cannot start",
    );
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

  const app = await buildServer({
    env,
    logger,
    db,
    jobs,
    storedCredentials: () => storedCredentialNames(db),
  });
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
