import type { Env, JobSender, Logger, WorkerHandle } from "@signalscout/core";
import {
  allStoredCredentialNames,
  assertStoredCredentialsAreReadable,
  billingSettingsFrom,
  builtInSources,
  configureNetworking,
  createDatabase,
  emailVerificationRequired,
  jobSenderFor,
  startBlockers,
  startJobSender as startJobSenderDefault,
  startWorker as startWorkerDefault,
  storedCredentialNames,
} from "@signalscout/core";
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
  /**
   * No login, no instance. US-017.
   *
   * Refused here rather than warned about, and this is the one boot check in
   * the product that is about somebody else reaching the process rather than
   * about the process working. An instance that starts without a session
   * secret serves an inbox of commercial research and a set of keys that spend
   * money to whoever finds the port, and it does it silently — every screen
   * works, which is exactly why nobody notices.
   *
   * `buildServer` still tolerates a build with no auth, because a test may
   * describe one. A process may not.
   */
  if (!env.AUTH_SECRET) {
    throw new Error(
      "AUTH_SECRET is not set, so this instance would have no login.\n" +
        "Generate one and put it in .env:\n\n" +
        "    openssl rand -base64 32\n",
    );
  }

  /**
   * An instance that charges must be able to charge. US-072.
   *
   * Here, before the worker and before the first connection, because the state
   * this refuses is the quiet one: `BILLING_MODE=stripe` with a missing price
   * or webhook secret runs the whole product, every screen works, every trial
   * runs out, and nobody is ever asked for money. Nothing about that looks
   * broken from the outside.
   *
   * `buildServer` reads the same function, so this is not the only place it is
   * checked. It is the place where the message arrives before anything else
   * has started.
   */
  billingSettingsFrom(env);

  /**
   * An instance that asks for a verified address must be able to ask. US-092.
   *
   * Here for `billingSettingsFrom`'s reason and against a worse failure. A
   * deployment with `AUTH_EMAIL_VERIFICATION=required` and no mail server does
   * not half work: it refuses every account it has, the owner's included, with
   * a message about a link that was never posted. Nothing on the screen says
   * the mail server is the problem.
   *
   * `authFor` reads the same function, so this is not the only place it is
   * checked. It is the place where the message arrives before the port is
   * bound.
   */
  emailVerificationRequired(env);

  // Before any provider is called. BUG-011: Node gives an address 250ms to
  // connect, and several providers take longer than that, so half their
  // requests failed with what looked like an outage.
  configureNetworking();

  const worker = env.WORKER_IN_PROCESS
    ? await startWorker({ databaseUrl: env.DATABASE_URL, logger, billing: env.BILLING_MODE })
    : null;

  if (!worker) {
    logger.info("WORKER_IN_PROCESS is false; expecting a separate worker container");
  }

  // The API's own pool, separate from the worker's. They have different
  // shapes of load — short reads against long jobs — and one pool shared
  // between them would let a slow poll hold connections a request is waiting
  // for. Nothing connects until the first query.
  const { db, close } = openDatabase(env.DATABASE_URL, {
    onError: (error) => logger.error({ err: error }, "an idle database connection failed"),
  });

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
  const configured = await allStoredCredentialNames(db);
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
    storedCredentials: (userId: string) => storedCredentialNames(db, userId),
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
