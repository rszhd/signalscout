/**
 * The four pipeline steps, as one contract.
 *
 * A step is a plain function of a payload and a context. It is not a pg-boss
 * handler: nothing here knows about jobs, retries or batches. That separation
 * is what let US-009 replace a step without touching the queue wiring, and
 * what lets a test drive one step and assert that the step before it did not
 * run.
 *
 */
import type { PgBoss } from "pg-boss";
import type { Database } from "../db/client.js";
import type { Logger } from "../logger.js";
import {
  type ClassifyPayload,
  type EstimatePayload,
  type FilterPayload,
  type NotifyPayload,
  notifyQueue,
  type PollPayload,
} from "./queues.js";

export interface StepContext {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly logger: Logger;
}

export type Step<Payload> = (payload: Payload, context: StepContext) => Promise<void>;

export interface PipelineSteps {
  readonly poll: Step<PollPayload>;
  readonly filter: Step<FilterPayload>;
  readonly classify: Step<ClassifyPayload>;
  readonly notify: Step<NotifyPayload>;
}

/**
 * Everything the worker serves, which is the pipeline and one more.
 *
 * US-014's cost test is not a pipeline step: nothing chains into it and
 * nothing chains out of it. It is here because it runs on the same worker,
 * with the same registry and the same keys, and a test replaces it the same
 * way it replaces the poll.
 */
export interface WorkerSteps extends PipelineSteps {
  readonly estimate: Step<EstimatePayload>;
}

/**
 * What runs in place of the classifier when no model is configured.
 *
 * US-009 built the classify step; this is the branch where the deployment has
 * not been given a key to run it with. It writes no match, because an unscored
 * post is not a match and inventing one would put a number in front of a
 * person that no model produced.
 *
 * It logs an error and completes rather than throwing. A missing key is not
 * transient: retrying it four times and dead-lettering the job buries the one
 * sentence the user has to read. `worker/collect.ts` treats a missing source
 * key the same way, for the same reason.
 */
export const unconfiguredClassify: Step<ClassifyPayload> = async (
  { monitorId, postIds },
  { boss, logger },
) => {
  logger.error(
    { monitorId, posts: postIds.length },
    "classification skipped: no model is configured. Set AI_API_KEY, or AI_PROVIDER=ollama.",
  );
  await boss.send(notifyQueue, { monitorId, matchIds: [] });
};
