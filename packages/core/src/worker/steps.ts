/**
 * The four pipeline steps, as one contract.
 *
 * A step is a plain function of a payload and a context. It is not a pg-boss
 * handler: nothing here knows about jobs, retries or batches. That separation
 * is what let US-009 replace a step without touching the queue wiring, and
 * what lets a test drive one step and assert that the step before it did not
 * run.
 *
 * Two of the four are placeholders. They are wired, logged and chained, and
 * they do no work, because the work belongs to tickets that have not been
 * done. A placeholder that passes its payload on is honest; one that quietly
 * dropped it would make the empty inbox look like a quiet day.
 */
import type { PgBoss } from "pg-boss";
import type { Database } from "../db/client.js";
import type { Logger } from "../logger.js";
import {
  type ClassifyPayload,
  classifyQueue,
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
 * US-008 replaces this with the keyword stage and the pgvector similarity
 * stage. Until then every post reaches the classifier, which is the permissive
 * direction: a threshold that drops a good lead is invisible, and an extra
 * model call is only a cost.
 */
export const passThroughFilter: Step<FilterPayload> = async (
  { monitorId, postIds },
  { boss, logger },
) => {
  logger.info({ monitorId, posts: postIds.length }, "pre-filter is not implemented yet (US-008)");
  await boss.send(classifyQueue, { monitorId, postIds });
};

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

/** US-016 replaces this with email and the webhook. */
export const unimplementedNotify: Step<NotifyPayload> = async (
  { monitorId, matchIds },
  { logger },
) => {
  logger.info(
    { monitorId, matches: matchIds.length },
    "notification is not implemented yet (US-016)",
  );
};
