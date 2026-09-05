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
import { type AiConfig, aiConfigFromEnvironment, needsApiKey } from "../ai/config.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase, type Database } from "../db/client.js";
import type { Logger } from "../logger.js";
import { builtInSources } from "../sources/index.js";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import { assertSourcesCanBeStored } from "../sources/storage.js";
import { createClassifyStep } from "./classify.js";
import { createCollectStep } from "./collect.js";
import { type CredentialLookup, credentialsFromEnvironment } from "./credentials.js";
import { createEstimateStep } from "./estimate.js";
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
  type RetryPolicy,
  scheduleTickCron,
  scheduleTickQueue,
} from "./queues.js";
import { enqueueDuePolls } from "./schedule.js";
import {
  passThroughFilter,
  type Step,
  type StepContext,
  unconfiguredClassify,
  unimplementedNotify,
  type WorkerSteps,
} from "./steps.js";

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
  /** Replaces one or more steps. US-008 arrives through here. */
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
  /** Retry and backoff settings, so a test does not wait out production's backoff. */
  retry?: RetryPolicy;
  /** False leaves the clock off, for a test that ticks the scheduler by hand. */
  scheduleTicks?: boolean;
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

export async function startWorker({
  databaseUrl,
  logger,
  registry,
  credentialsFor = credentialsFromEnvironment(),
  steps = {},
  classifier,
  aiConfig,
  retry = defaultRetryPolicy,
  scheduleTicks = true,
}: StartWorkerOptions): Promise<WorkerHandle> {
  const { db, close } = createDatabase(databaseUrl);

  const sources =
    registry ??
    createSourceRegistry({ definitions: builtInSources, runtime: createSourceRuntime({ logger }) });

  // At boot, so a connector whose posts the schema cannot hold stops the
  // process instead of failing one poll, quietly, every hour.
  assertSourcesCanBeStored(sources.ids());

  const boss = new PgBoss({ connectionString: databaseUrl });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));

  await boss.start();

  for (const definition of queueDefinitions(retry)) {
    const { name, ...options } = definition;
    await boss.createQueue(name, options);
  }

  const context: StepContext = { db, boss, logger };

  const model =
    classifier ??
    classifierFromEnvironment(aiConfig ?? aiConfigFromEnvironment(loadAiEnv()), logger);

  const pipeline: WorkerSteps = {
    poll: steps.poll ?? createCollectStep({ registry: sources, credentialsFor }),
    estimate: steps.estimate ?? createEstimateStep({ registry: sources, credentialsFor }),
    filter: steps.filter ?? passThroughFilter,
    classify:
      steps.classify ?? (model ? createClassifyStep({ classifier: model }) : unconfiguredClassify),
    notify: steps.notify ?? unimplementedNotify,
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

  await work<PollPayload>(pollQueue, pipeline.poll, named);
  await work<FilterPayload>(filterQueue, pipeline.filter, named);
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
  });

  if (scheduleTicks) {
    await boss.schedule(scheduleTickQueue, scheduleTickCron);
  }

  logger.info(
    {
      queues: queueDefinitions(retry).map((queue) => queue.name),
      sources: sources.ids(),
      model: model ? `${model.provider}/${model.model}` : "none",
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
