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
import { createDatabase, type Database } from "../db/client.js";
import type { Logger } from "../logger.js";
import { builtInSources } from "../sources/index.js";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import { assertSourcesCanBeStored } from "../sources/storage.js";
import { createCollectStep } from "./collect.js";
import { type CredentialLookup, credentialsFromEnvironment } from "./credentials.js";
import {
  type ClassifyPayload,
  classifyQueue,
  retryPolicy as defaultRetryPolicy,
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
  type PipelineSteps,
  passThroughFilter,
  type Step,
  type StepContext,
  unimplementedClassify,
  unimplementedNotify,
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
  /** Replaces one or more steps. US-008 and US-009 arrive through here. */
  steps?: Partial<PipelineSteps>;
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
function instrument<Payload extends { monitorId: string }>(
  queue: string,
  step: Step<Payload>,
  context: StepContext,
): (payload: Payload, jobId: string) => Promise<void> {
  return async (payload, jobId) => {
    const startedAt = Date.now();

    try {
      await step(payload, context);
      context.logger.info(
        {
          queue,
          jobId,
          monitorId: payload.monitorId,
          durationMs: Date.now() - startedAt,
          outcome: "ok",
        },
        "job finished",
      );
    } catch (error) {
      context.logger.error(
        {
          queue,
          jobId,
          monitorId: payload.monitorId,
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

export async function startWorker({
  databaseUrl,
  logger,
  registry,
  credentialsFor = credentialsFromEnvironment(),
  steps = {},
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

  const pipeline: PipelineSteps = {
    poll: steps.poll ?? createCollectStep({ registry: sources, credentialsFor }),
    filter: steps.filter ?? passThroughFilter,
    classify: steps.classify ?? unimplementedClassify,
    notify: steps.notify ?? unimplementedNotify,
  };

  const work = async <Payload extends { monitorId: string }>(
    queue: string,
    step: Step<Payload>,
  ): Promise<void> => {
    const run = instrument(queue, step, context);
    await boss.work<Payload>(queue, async (jobs) => {
      for (const job of jobs) await run(job.data, job.id);
    });
  };

  await work<PollPayload>(pollQueue, pipeline.poll);
  await work<FilterPayload>(filterQueue, pipeline.filter);
  await work<ClassifyPayload>(classifyQueue, pipeline.classify);
  await work<NotifyPayload>(notifyQueue, pipeline.notify);

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
    { queues: queueDefinitions(retry).map((queue) => queue.name), sources: sources.ids() },
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
