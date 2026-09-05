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
import { createTriager, type Triager } from "../ai/triage.js";
import { loadAiEnv, loadNotificationEnv } from "../config/env.js";
import { createDatabase, type Database, poolOptions } from "../db/client.js";
import type { Logger } from "../logger.js";
import type { NotificationTransport } from "../notifications/deliver.js";
import { createNotificationTransport } from "../notifications/transport.js";
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
import { type Step, type StepContext, unconfiguredClassify, type WorkerSteps } from "./steps.js";

export type HeartbeatPayload = Record<string, never>;

export interface WorkerHandle {
  boss: PgBoss;
  db: Database;
  stop: () => Promise<void>;
}

export interface StartWorkerOptions {
  databaseUrl: string;
  logger: Logger;
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
  notificationTransport?: NotificationTransport;
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
  notificationTransport,
}: StartWorkerOptions): Promise<WorkerHandle> {
  const { db, close } = createDatabase(databaseUrl);

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
  const lookup = credentialsFor ?? credentialsFromStore(db, undefined, process.env, logger);

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
    filter: steps.filter ?? createFilterStep({ embedder: embedding, triager: triage }),
    replies: steps.replies ?? createRepliesStep({ registry: sources, credentialsFor: lookup }),
    classify:
      steps.classify ?? (model ? createClassifyStep({ classifier: model }) : unconfiguredClassify),
    notify:
      steps.notify ??
      createNotifyStep(notificationTransport ?? createNotificationTransport(loadNotificationEnv())),
  };

  const work = async <Payload>(
    queue: string,
    step: Step<Payload>,
    subject: (payload: Payload) => Record<string, unknown>,
  ): Promise<void> => {
    const run = instrument(queue, step, context, subject);
    await boss.work<Payload>(queue, async (jobs) => {
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

  await boss.work(scheduleTickQueue, async () => {
    await enqueueDuePolls(db, boss, logger);
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
      // Graceful: a job that is running gets to finish. pg-boss stops fetching
      // first, so nothing new is claimed while the last ones drain.
      await boss.stop({ graceful: true });
      await close();
    },
  };
}
