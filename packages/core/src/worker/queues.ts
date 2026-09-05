/**
 * The queues this deployment serves, and the retry policy they share.
 *
 * The pipeline is four queues and not one long job because the steps fail
 * differently and cost differently. A model provider that is down must not
 * make the poll re-fetch posts that were already paid for, and a retry of the
 * classify step must never re-run the poll step. Separate queues give that for
 * free: a job carries the ids the next step needs, so retrying one step reads
 * rows that are already stored rather than fetching them again.
 */
import type { Queue } from "pg-boss";

/** The queue every deployment has, so "is the worker alive?" has an answer. */
export const heartbeatQueue = "heartbeat";

/** poll -> filter -> classify -> notify. PLAN.md, *Monitoring flow*. */
export const pollQueue = "poll";
export const filterQueue = "filter";
export const classifyQueue = "classify";
export const notifyQueue = "notify";

/**
 * Where a job goes when it has failed every attempt.
 *
 * Nothing works this queue. That is the point: a job that throws for ever must
 * stop, not retry until the user's API allowance is gone. One queue collects
 * from all four steps, and `sourceName` on each row says which step failed, so
 * inspecting a night of failures is one `SELECT`.
 */
export const deadLetterQueue = "dead-letter";

/**
 * US-014's cost test: what a query would collect, and what it would cost.
 *
 * Not a fifth pipeline step. It runs when a person presses a button rather
 * than when a monitor is due, it holds a run and not a monitor, and its
 * failure is a sentence on a screen somebody is looking at. It is a queue for
 * the same reason the poll is one: the sample is paid for when it is
 * triggered and served about two minutes later, so the wait has to outlive
 * the request that started it.
 */
export const estimateQueue = "estimate";

/** US-015: one global job, deduplicating shared posts across monitors. */
export const reconcileQueue = "reconcile";

/**
 * The scheduler's own tick. It is not a fifth pipeline step: it holds no
 * monitor and does no work beyond asking which monitors are due and sending
 * their poll jobs. It runs on a `pg-boss` cron schedule so the clock lives in
 * Postgres, where `SELECT * FROM pgboss.schedule` can answer "is it running?".
 */
export const scheduleTickQueue = "schedule-tick";

/** Once a minute. The poll interval floor is sixty seconds, so this is enough. */
export const scheduleTickCron = "* * * * *";

export const pipelineQueues = [pollQueue, filterQueue, classifyQueue, notifyQueue] as const;
export type PipelineQueue = (typeof pipelineQueues)[number];

/** Every queue the worker creates, dead letter first: pg-boss needs it to exist. */
export const allQueues = [
  deadLetterQueue,
  heartbeatQueue,
  scheduleTickQueue,
  estimateQueue,
  reconcileQueue,
  ...pipelineQueues,
] as const;

export interface PollPayload {
  readonly monitorId: string;
}

/** A cost test names its run. There may be no monitor yet, which is the point of it. */
export interface EstimatePayload {
  readonly estimateId: string;
}

export interface FilterPayload {
  readonly monitorId: string;
  /** Posts this poll saw, new and already stored. Rows, not payloads. */
  readonly postIds: readonly string[];
}

export interface ClassifyPayload {
  readonly monitorId: string;
  readonly postIds: readonly string[];
}

export interface NotifyPayload {
  readonly monitorId: string;
  readonly matchIds: readonly string[];
}

/** Every pipeline payload names its monitor, because every log line must. */
export type PipelinePayload = PollPayload | FilterPayload | ClassifyPayload | NotifyPayload;

export interface RetryPolicy {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  /** pg-boss rejects a cap without backoff, so it is absent when backoff is off. */
  readonly retryDelayMax?: number;
}

/**
 * Five attempts, then the dead letter queue.
 *
 * The numbers are chosen against the failure that matters, which is not a
 * flaky network: it is a job that throws for ever while nobody watches. Five
 * attempts with exponential backoff from thirty seconds spans roughly an hour,
 * which outlasts a provider restart and a rate-limit window, and then stops.
 * The cap keeps the last gap from growing past an hour, so a job that would
 * have succeeded is not left waiting a day.
 */
export const retryPolicy: RetryPolicy = {
  retryLimit: 4,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
};

/**
 * `stately` allows one job per state per singleton key: one queued, one
 * retrying, one active. Sent with the monitor id as the key, that is exactly
 * the two rules this queue needs and neither is a lock we wrote.
 *
 * *One active* is "two workers never poll the same monitor at the same time".
 * *One queued* is what stops a poll that runs longer than its own interval
 * from building a backlog of polls that then run back to back, each one
 * spending money. `retry` having its own slot is why the policy is `stately`
 * and not `exclusive`: under `exclusive` a queued follow-up and a retrying job
 * compete for one row.
 */
export const pollQueuePolicy = "stately" as const;

export interface QueueDefinition extends Queue {
  name: string;
}

/**
 * Every queue, with the settings it is created with. Exported as data so a
 * test can assert what production configures rather than what a test does.
 */
export function queueDefinitions(retry: RetryPolicy = retryPolicy): readonly QueueDefinition[] {
  return [
    {
      name: deadLetterQueue,
      // A job here has already failed everything it was allowed to fail.
      retryLimit: 0,
      // Thirty days. A failure that nobody looked at inside a month is not
      // going to be looked at, but a failure erased in a fortnight is one
      // nobody can look at after a holiday.
      retentionSeconds: 30 * 24 * 60 * 60,
    },
    { name: heartbeatQueue },
    { name: reconcileQueue, policy: "stately", deadLetter: deadLetterQueue, ...retry },
    { name: scheduleTickQueue, policy: "stately", retryLimit: 0 },
    { name: pollQueue, policy: pollQueuePolicy, deadLetter: deadLetterQueue, ...retry },
    // `stately` with the run as the key, like the poll: one active job per
    // run, so two workers cannot sample the same query twice and bill for it
    // twice, and one queued, so a resume booked twice is booked once.
    { name: estimateQueue, policy: pollQueuePolicy, deadLetter: deadLetterQueue, ...retry },
    { name: filterQueue, deadLetter: deadLetterQueue, ...retry },
    { name: classifyQueue, deadLetter: deadLetterQueue, ...retry },
    { name: notifyQueue, policy: "stately", deadLetter: deadLetterQueue, ...retry },
  ];
}
