/**
 * Boot pg-boss, create the queues, register the handlers and start the clock.
 *
 * The same function is called by the worker container and, when
 * WORKER_IN_PROCESS is true, by the API process. There is no second code path,
 * which is why the two modes cannot drift.
 *
 * `pg-boss` runs its own migrations into the `pgboss` schema on `start()`, in
 * the same database as everything else. Nothing here applies them, and nothing
 * here should: a stuck queue is then `SELECT * FROM pgboss.job`, in the
 * database the self-hoster already backs up.
 */
import { PgBoss } from "pg-boss";
import { type Classifier, createClassifier } from "../ai/classify.js";
import {
  type AiConfig,
  aiConfigFromEnvironment,
  type EmbeddingConfig,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  needsApiKey,
  triageConfigFromEnvironment,
} from "../ai/config.js";
import { createEmbedder, type Embedder } from "../ai/embed.js";
import { readAiEnvironment as readAiSettingsEnvironment } from "../ai/settings.js";
import { createTriager, type Triager } from "../ai/triage.js";
import type { SignupMode } from "../auth/user.js";
import type { BillingMode } from "../billing/index.js";
import { loadAiEnv, loadNotificationEnv, loadSignupEnv } from "../config/env.js";
import {
  machineKeysUsable,
  providerKeyEnvironment,
  webhookSecretEnvironment,
  withoutMachineModelKeys,
} from "../config/machine-keys.js";
import { createDatabase, type Database, poolOptions } from "../db/client.js";
import type { Logger } from "../logger.js";
import { configureNetworking } from "../net.js";
import type { NotificationTransport } from "../notifications/deliver.js";
import { webhookSecretFor } from "../notifications/secret.js";
import { createNotificationTransport } from "../notifications/transport.js";
import { optionalEncryptionKey } from "../secrets/cipher.js";
import { assertStoredCredentialsAreReadable } from "../secrets/store.js";
import { builtInSources } from "../sources/index.js";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import { assertSourcesCanBeStored } from "../sources/storage.js";
import { createClassifyStep } from "./classify.js";
import { createCollectStep } from "./collect.js";
import { type CredentialLookup, credentialsFromStore } from "./credentials.js";
import { createEstimateStep } from "./estimate.js";
import { createFilterStep } from "./filter.js";
import { createNotifyStep, enqueueNotifications } from "./notify.js";
import {
  type ClassifyPayload,
  classifyQueue,
  retryPolicy as defaultRetryPolicy,
  type EstimatePayload,
  estimateQueue,
  type FilterPayload,
  filterQueue,
  heartbeatQueue,
  type NotifyPayload,
  notifyQueue,
  type PollPayload,
  pollQueue,
  queueDefinitions,
  type RepliesPayload,
  type RetryPolicy,
  reconcileQueue,
  repliesQueue,
  scheduleTickCron,
  scheduleTickQueue,
} from "./queues.js";
import { createReconcileStep } from "./reconcile.js";
import { createRepliesStep } from "./replies.js";
import { enqueueDuePolls } from "./schedule.js";
import type { Step, StepContext, WorkerSteps } from "./steps.js";

export type HeartbeatPayload = Record<string, never>;

export interface WorkerHandle {
  boss: PgBoss;
  db: Database;
  stop: () => Promise<void>;
}

export interface StartWorkerOptions {
  databaseUrl: string;
  logger: Logger;
  /**
   * Whether this deployment takes registrations. US-081.
   *
   * It decides one thing here and it is the expensive one: on an instance
   * taking registrations the keys in `.env` are the machine's and not an
   * account's, so a poll and a classification run on the owner's own stored
   * keys or they do not run. Defaults to the environment, which is `closed`.
   */
  signup?: SignupMode;
  /** The connectors to poll with. Defaults to the built-in ones over the real network. */
  registry?: SourceRegistry;
  /** Where source keys come from. US-004 replaces the environment with the database. */
  credentialsFor?: CredentialLookup;
  /** Replaces one or more steps. A test passes a fake; nothing else does. */
  steps?: Partial<WorkerSteps>;
  /**
   * Which model scores posts. Defaults to the one AI_PROVIDER and AI_MODEL
   * name. A deployment with no key configured gets no classifier and says so
   * once per job, rather than failing to boot: polling still works, and the
   * posts are stored for when a key arrives.
   */
  classifier?: Classifier;
  /** The AI settings, when they do not come from the process environment. */
  aiConfig?: AiConfig;
  /**
   * Which model embeds posts for the pre-filter. Defaults to the one
   * AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL name, and to none when they
   * name nothing — the pre-filter then runs its free keyword stage only.
   */
  embedder?: Embedder;
  /** The embedding settings, when they do not come from the process environment. */
  embeddingConfig?: EmbeddingConfig;
  /**
   * Which model triages before the classifier is paid to read anything.
   *
   * Unlike the embedder, this defaults to something rather than to nothing:
   * `triageConfigFromEnvironment` falls every setting back to the classifier's,
   * so a deployment that names no triage model still gets the stage. It is
   * absent only when the classifier itself could not be built, because there is
   * then no model to fall back to.
   */
  triager?: Triager;
  /** The triage settings, when they do not come from the process environment. */
  triageConfig?: AiConfig;
  /** Retry and backoff settings, so a test does not wait out production's backoff. */
  retry?: RetryPolicy;
  /** False leaves the clock off, for a test that ticks the scheduler by hand. */
  scheduleTicks?: boolean;
  /**
   * How often a worker looks for a job, in seconds. Absent leaves pg-boss on
   * its own default.
   *
   * It exists for the suite, and the reason is measured. A pipeline test sends
   * a job and waits for a worker to pick it up, so its cost is the polling
   * interval and not the work: on 2026-09-06 the five worker files were 397 of
   * the suite's 435 seconds, every one of them at four to six seconds a test,
   * which is a wait rather than a computation.
   *
   * Production leaves it unset. A short interval there would be a query per
   * queue per second against a database doing real work, to save a latency
   * nobody is waiting on — a poll that starts a second later is a poll that
   * starts a second later.
   */
  pollingIntervalSeconds?: number;
  notificationTransport?: NotificationTransport;
  /**
   * Whether this deployment charges. `off` unless it says otherwise. US-072.
   *
   * The scheduler is the only thing here that reads it, and it is the half of
   * the billing gate that costs money: an account whose trial ran out keeps
   * polling until this is on.
   */
  billing?: BillingMode;
}

/**
 * How often a worker looks for a job, from the environment.
 *
 * `WORKER_POLLING_INTERVAL_SECONDS`, and only the suite sets it. pg-boss
 * refuses anything under half a second, so an out-of-range value is ignored
 * rather than passed on to be rejected at boot.
 */
function pollingIntervalFromEnvironment(): number | undefined {
  const configured = Number(process.env.WORKER_POLLING_INTERVAL_SECONDS);

  return Number.isFinite(configured) && configured >= 0.5 ? configured : undefined;
}

/**
 * Wrap a step so that every job logs its monitor id, its duration and its
 * outcome, whatever the step does or fails to do.
 *
 * One wrapper rather than a log line inside each step: the outcome of a step
 * that throws can only be recorded by something outside it, and a duration
 * measured inside the step cannot include the failure that ended it.
 */
function instrument<Payload>(
  queue: string,
  step: Step<Payload>,
  context: StepContext,
  /**
   * What this queue's log line calls the thing being worked on.
   *
   * A pipeline job names its monitor. A cost test names its run, because it
   * may have no monitor at all — that is the case the feature exists for.
   */
  subject: (payload: Payload) => Record<string, unknown>,
): (payload: Payload, jobId: string) => Promise<void> {
  return async (payload, jobId) => {
    const startedAt = Date.now();

    try {
      await step(payload, context);
      context.logger.info(
        { queue, jobId, ...subject(payload), durationMs: Date.now() - startedAt, outcome: "ok" },
        "job finished",
      );
    } catch (error) {
      context.logger.error(
        {
          queue,
          jobId,
          ...subject(payload),
          durationMs: Date.now() - startedAt,
          outcome: "failed",
          err: error,
        },
        "job failed",
      );
      // Rethrown, always. Swallowing it here would complete the job, and a
      // pipeline that completes every job is a pipeline with no retries and
      // an empty dead letter queue that reads as a healthy night.
      throw error;
    }
  };
}

/**
 * Build the classifier the environment describes, or none.
 *
 * The one failure this hides is a missing key, and it is reported rather than
 * hidden: an error line naming the variable, once, at boot. Anything else
 * thrown while building a provider is a real misconfiguration and stops the
 * process, which is where a wrong base URL belongs.
 */
function classifierFromEnvironment(config: AiConfig, logger: Logger): Classifier | undefined {
  if (needsApiKey(config.provider) && !config.apiKey) {
    logger.error(
      { provider: config.provider, model: config.model },
      "no model is configured: set AI_API_KEY, or AI_PROVIDER=ollama for a local model. Posts will be collected but not scored.",
    );
    return undefined;
  }

  return createClassifier({ config });
}

/**
 * Build the embedder the environment describes, or none.
 *
 * None is a supported deployment and not a broken one, so it is an info line
 * and not an error: Anthropic is our default provider and it does not embed,
 * so the common install has a classifier and no embedder. The pre-filter then
 * runs its free stage and sends everything it keeps to the model, which costs
 * more and drops nothing.
 *
 * A provider that was named and cannot be reached is different. That is a
 * mistake somebody made, so it names the variable that fixes it.
 */
function embedderFromEnvironment(
  config: EmbeddingConfig | undefined,
  logger: Logger,
): Embedder | undefined {
  if (!config) {
    logger.info(
      "no embedding model is configured: the pre-filter will match keywords only. Set AI_EMBEDDING_PROVIDER and AI_EMBEDDING_MODEL to add the similarity stage.",
    );
    return undefined;
  }

  if (embeddingNeedsApiKey(config.provider) && !config.apiKey) {
    logger.error(
      { provider: config.provider, model: config.model },
      "the embedding provider has no key: set AI_EMBEDDING_API_KEY. The pre-filter will match keywords only.",
    );
    return undefined;
  }

  return createEmbedder({ config });
}

/**
 * Build the triager the environment describes.
 *
 * This returns none only when the model behind it cannot be built at all —
 * usually a missing key — and in that case the classifier is unconfigured too,
 * so nothing downstream would run either. There is no "triage is switched off"
 * deployment on purpose: the settings fall back to the classifier's, so the
 * question a deployment answers is which model triages, never whether one does.
 */
function triagerFromEnvironment(
  config: AiConfig,
  classifierModel: string | undefined,
  logger: Logger,
): Triager | undefined {
  if (needsApiKey(config.provider) && !config.apiKey) {
    logger.error(
      { provider: config.provider, model: config.model },
      "the triage provider has no key: set AI_TRIAGE_API_KEY, or AI_API_KEY if triage shares the classifier's provider. Nothing will be triaged.",
    );
    return undefined;
  }

  /**
   * The cascade only saves money when the second reader is dearer than the
   * first, and this is the one line that says so out loud.
   *
   * US-030 measured it: a triage answer is not shorter than a classification.
   * The answer is one word, but the tokens billed as output include the
   * model's own reasoning, so on the pair we measured triage cost about the
   * same per item as the classification it was meant to avoid. All the saving
   * therefore comes from the price gap, and with no gap there is none: on one
   * model for both stages, triage made 46 comments 48% dearer rather than 48%
   * cheaper.
   *
   * It is a warning and not a refusal because the stage still does its other
   * job — it keeps the experts answering under a post out of the inbox — and
   * because a deployment may be running a local model, where the money
   * argument does not apply at all.
   */
  if (classifierModel !== undefined && config.model === classifierModel) {
    logger.warn(
      { model: config.model },
      "triage and classification are the same model, so triage adds cost rather than saving it. Set AI_TRIAGE_MODEL to a cheaper one, or expect a larger bill.",
    );
  }

  return createTriager({ config });
}

export async function startWorker({
  databaseUrl,
  logger,
  registry,
  credentialsFor,
  steps = {},
  classifier,
  aiConfig,
  embedder,
  embeddingConfig,
  triager,
  triageConfig,
  retry = defaultRetryPolicy,
  scheduleTicks = true,
  pollingIntervalSeconds,
  notificationTransport,
  billing = "off",
  signup = loadSignupEnv(),
}: StartWorkerOptions): Promise<WorkerHandle> {
  // Before any provider is called. See `net.ts`: Node's 250ms per-address
  // connect budget is shorter than several providers take to answer.
  configureNetworking();

  const { db, close } = createDatabase(databaseUrl, {
    onError: (error) => logger.error({ err: error }, "an idle database connection failed"),
  });

  // Before anything is queued. A stored credential this process cannot read
  // is a poll that would fail at 02:00 with a message about a provider, so it
  // is found here instead, with a message about a key.
  //
  // The pool is closed on the way out. A refusal that leaves connections open
  // is a process that will not exit, and a container that will not exit reads
  // as a hang rather than as the configuration error it is.
  try {
    await assertStoredCredentialsAreReadable(db);
  } catch (error) {
    await close();
    throw error;
  }

  // The logger, so a key still read from its deprecated variable says so once.
  // The environment half is empty where signup is open: a stranger's monitor
  // must not poll on the machine's provider keys. US-081.
  const lookup =
    credentialsFor ??
    credentialsFromStore(db, undefined, providerKeyEnvironment(signup, process.env), logger);

  const sources =
    registry ??
    createSourceRegistry({
      definitions: builtInSources,
      runtime: createSourceRuntime({ logger }),
    });

  // At boot, so a connector whose posts the schema cannot hold stops the
  // process instead of failing one poll, quietly, every hour.
  assertSourcesCanBeStored(sources.platforms());

  const boss = new PgBoss({ connectionString: databaseUrl, ...poolOptions() });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));

  await boss.start();

  for (const definition of queueDefinitions(retry)) {
    const { name, ...options } = definition;
    await boss.createQueue(name, options);
  }

  const context: StepContext = { db, boss, logger };

  // Read at most once, and only when something still needs it. Two reads
  // would be two chances for one environment to describe two deployments.
  let aiEnvironment: ReturnType<typeof loadAiEnv> | undefined;
  const readAiEnvironment = () => {
    aiEnvironment ??= loadAiEnv();
    return aiEnvironment;
  };

  /**
   * The same, with the machine's model keys taken out where they are nobody's
   * to spend. US-081. It is what an account's own settings are laid over, so a
   * job with no key of its own does not run rather than running on the
   * owner's.
   */
  const readAccountBaseEnvironment = () =>
    machineKeysUsable(signup) ? readAiEnvironment() : withoutMachineModelKeys(readAiEnvironment());

  /**
   * The three model clients an account uses. US-068.
   *
   * One worker process serves every account, and each may pay with its own key,
   * so these are built per owner rather than once at boot. What is *not* per
   * owner is any of the fallback logic: `readAiSettings` lays an account's rows
   * over the instance's environment and hands an ordinary `AiEnvironment` to
   * the same three functions that have always read it.
   *
   * **Cached, and the cache is what makes this affordable.** Building a client
   * decrypts a key and constructs an SDK object; a poll of fifty posts would
   * otherwise do that fifty times. The cache is per process and lives as long
   * as the worker, which means **a key changed on the screen reaches the worker
   * on its next restart and not before**. That is the one real cost of this
   * design and it is written into docs/secrets.md rather than left to be
   * discovered.
   *
   * An injected client wins over all of it. Every test passes one, and so does
   * every live script, so neither pays for a database read per job.
   */
  const modelCache = new Map<
    string,
    {
      classifier: Classifier | undefined;
      embedder: Embedder | undefined;
      triager: Triager | undefined;
    }
  >();

  async function modelsFor(userId: string) {
    const cached = modelCache.get(userId);
    if (cached) return cached;

    const instance = readAccountBaseEnvironment();
    // An account with no rows gets the instance's environment back, so the
    // common install pays one small query per owner per process and nothing
    // else changes about it.
    const mine = await readAiSettingsEnvironment(db, userId, instance);

    const own = {
      classifier:
        classifier ?? classifierFromEnvironment(aiConfig ?? aiConfigFromEnvironment(mine), logger),
      embedder:
        embedder ??
        embedderFromEnvironment(embeddingConfig ?? embeddingConfigFromEnvironment(mine), logger),
      triager: undefined as Triager | undefined,
    };

    own.triager =
      triager ??
      triagerFromEnvironment(
        triageConfig ?? triageConfigFromEnvironment(mine),
        own.classifier?.model,
        logger,
      );

    modelCache.set(userId, own);
    return own;
  }

  /**
   * The instance's own clients, for the boot line below and for nothing else.
   *
   * Built from the environment alone, so the log says what this deployment is
   * configured with rather than what one account happens to have chosen.
   */
  const model =
    classifier ??
    classifierFromEnvironment(aiConfig ?? aiConfigFromEnvironment(readAiEnvironment()), logger);

  const embedding =
    embedder ??
    embedderFromEnvironment(
      embeddingConfig ?? embeddingConfigFromEnvironment(readAiEnvironment()),
      logger,
    );

  const triage =
    triager ??
    triagerFromEnvironment(
      triageConfig ?? triageConfigFromEnvironment(readAiEnvironment()),
      model?.model,
      logger,
    );

  const pipeline: WorkerSteps = {
    reconcile:
      steps.reconcile ?? createReconcileStep({ registry: sources, credentialsFor: lookup }),
    poll: steps.poll ?? createCollectStep({ registry: sources, credentialsFor: lookup }),
    estimate: steps.estimate ?? createEstimateStep({ registry: sources, credentialsFor: lookup }),
    filter:
      steps.filter ??
      createFilterStep({
        embedderFor: async (userId) => (await modelsFor(userId)).embedder,
        triagerFor: async (userId) => (await modelsFor(userId)).triager,
      }),
    replies: steps.replies ?? createRepliesStep({ registry: sources, credentialsFor: lookup }),
    classify:
      steps.classify ??
      createClassifyStep({ classifierFor: async (userId) => (await modelsFor(userId)).classifier }),
    notify:
      steps.notify ??
      createNotifyStep(
        notificationTransport ??
          createNotificationTransport(loadNotificationEnv(), {
            // US-097. Where a stranger may register, a webhook URL is a
            // stranger's string and this worker makes the request — so it may
            // not be aimed at an address inside our own network. Self-hosted
            // the network is already the owner's and nothing changes.
            guardAddresses: !machineKeysUsable(signup),
          }),
        {
          // US-094. Optional everywhere: `APP_URL` is required only for Stripe,
          // so the button is offered where a deployment has said where it
          // answers and left out where it has not.
          appUrl: process.env.APP_URL,
          // US-096. The account's own secret, falling back to the instance's.
          // Read per delivery: one worker serves every account, and a secret
          // regenerated on the screen must sign the next attempt.
          signingSecretFor: (userId) =>
            webhookSecretFor(
              db,
              userId,
              optionalEncryptionKey(),
              // Undefined where signup is open, so an account there signs with
              // its own secret or with nothing at all.
              webhookSecretEnvironment(signup),
            ),
        },
      ),
  };

  /**
   * Spread rather than passed, so an unset interval leaves pg-boss's own.
   *
   * The environment is the fallback, the way `DATABASE_POOL_SIZE` is: this is
   * a property of the setup rather than of the code each test happens to call,
   * and `vitest.config.ts` sets it once for every worker test that exists or
   * will exist. Nothing sets it in production.
   */
  const interval = pollingIntervalSeconds ?? pollingIntervalFromEnvironment();
  const workerOptions = interval === undefined ? {} : { pollingIntervalSeconds: interval };

  const work = async <Payload>(
    queue: string,
    step: Step<Payload>,
    subject: (payload: Payload) => Record<string, unknown>,
  ): Promise<void> => {
    const run = instrument(queue, step, context, subject);
    await boss.work<Payload>(queue, workerOptions, async (jobs) => {
      for (const job of jobs) await run(job.data, job.id);
    });
  };

  const named = <Payload extends { monitorId: string }>(payload: Payload) => ({
    monitorId: payload.monitorId,
  });

  await work(reconcileQueue, pipeline.reconcile, () => ({}));
  await work<PollPayload>(pollQueue, pipeline.poll, named);
  await work<FilterPayload>(filterQueue, pipeline.filter, named);
  await work<RepliesPayload>(repliesQueue, pipeline.replies, named);
  await work<ClassifyPayload>(classifyQueue, pipeline.classify, named);
  await work<NotifyPayload>(notifyQueue, pipeline.notify, named);
  await work<EstimatePayload>(estimateQueue, pipeline.estimate, ({ estimateId }) => ({
    estimateId,
  }));

  await boss.work<HeartbeatPayload>(heartbeatQueue, async (jobs) => {
    for (const job of jobs) logger.info({ jobId: job.id }, "heartbeat");
  });

  await boss.work(scheduleTickQueue, workerOptions, async () => {
    await enqueueDuePolls(db, boss, logger, billing);
    await enqueueNotifications(db, boss);
    await boss.send(reconcileQueue, {}, { singletonKey: "all" });
  });

  if (scheduleTicks) {
    await boss.schedule(scheduleTickQueue, scheduleTickCron);
  }

  logger.info(
    {
      queues: queueDefinitions(retry).map((queue) => queue.name),
      connectors: sources.keys().map((key) => `${key.platformId} via ${key.providerId}`),
      model: model ? `${model.provider}/${model.model}` : "none",
      embedder: embedding ? `${embedding.provider}/${embedding.model}` : "none",
      triager: triage ? `${triage.provider}/${triage.model}` : "none",
    },
    "worker ready",
  );

  return {
    boss,
    db,
    stop: async () => {
      /**
       * `stop()` asks pg-boss to shut down and resolves before it has. Its own
       * pool is still open at that point, so a caller that closes the database
       * next — or drops it, which is what a test does — pulls the connections
       * out from under a library that is still using them. The `stopped` event
       * is the end of the shutdown, and this waits for it.
       *
       * Graceful: a job that is running gets to finish. pg-boss stops fetching
       * first, so nothing new is claimed while the last ones drain.
       */
      const stopped = new Promise<void>((resolve) => {
        boss.once("stopped", () => resolve());
      });

      await boss.stop({ graceful: true });
      await stopped;
      await close();
    },
  };
}
