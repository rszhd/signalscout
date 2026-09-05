/**
 * Writing one row to the call ledger.
 *
 * Every call to a model is recorded, whatever it returned and whatever it was
 * for. `db/schema.ts` gives the three reasons: a self-hoster asks what their
 * key was spent on and a refusal is billed like an answer; US-013's budget
 * guard needs spend it can add up without asking the provider; and the
 * classifier's failure count has to survive a restart.
 *
 * One writer, because US-010 added the second caller. Two `insert` statements
 * would be two places to forget the new column, and the column that gets
 * forgotten is always the one a bill page reads.
 */
import type { Queryable } from "../db/client.js";
import { type ModelCallOutcome, type ModelCallPurpose, modelCalls } from "../db/schema.js";
import type { ModelCall } from "./call.js";

export interface RecordModelCallInput {
  readonly purpose: ModelCallPurpose;
  readonly outcome: ModelCallOutcome;
  readonly call: ModelCall;
  /** Null before the monitor exists: the queries are written before it does. */
  readonly monitorId?: string | null;
  /**
   * `monitors.version` at the moment of the call. Required for a
   * classification, because the classify step's skip reads it; null for a call
   * no version describes. The check constraint holds the same rule.
   */
  readonly monitorVersion?: number | null;
  /** Null for a call that is not about one post. */
  readonly postId?: string | null;
  /** The provider's message, for a call that did not produce what was asked. */
  readonly error?: string | null;
}

export async function recordModelCall(
  db: Queryable,
  {
    purpose,
    outcome,
    call,
    monitorId = null,
    monitorVersion = null,
    postId = null,
    error = null,
  }: RecordModelCallInput,
): Promise<void> {
  await db.insert(modelCalls).values({
    monitorId,
    monitorVersion,
    postId,
    provider: call.provider,
    model: call.model,
    purpose,
    outcome,
    inputTokens: call.inputTokens ?? null,
    outputTokens: call.outputTokens ?? null,
    latencyMs: call.latencyMs,
    estimatedCostMicros: call.estimatedCostMicros ?? null,
    error,
  });
}
