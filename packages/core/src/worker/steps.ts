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
import type {
  ClassifyPayload,
  EstimatePayload,
  FilterPayload,
  NotifyPayload,
  PollPayload,
  RepliesPayload,
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
  readonly replies: Step<RepliesPayload>;
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
  readonly reconcile: Step<Record<string, never>>;
}
