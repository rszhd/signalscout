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
 *
 * The one read back is at the bottom: how many posts the classifier has
 * actually read, which is the other half of the pre-filter's own sentence.
 */
import { and, countDistinct, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database, Queryable } from "../db/client.js";
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

/**
 * How many posts each monitor's classifier has read, for the screen that says
 * so beside what the pre-filter skipped.
 *
 * Distinct posts, not calls: BUG-003's skip is keyed by monitor version, so a
 * post re-scored after its monitor was edited is one post read twice and not
 * two posts.
 *
 * Every outcome counts, including a call that timed out or came back
 * malformed. The question is what the model was asked to read, and a failed
 * answer was asked for, billed, and is the reason a post has no match.
 *
 * A monitor with no classification is absent from the map rather than present
 * with a zero, the same shape `filterDropCounts` uses: zero here is not
 * ambiguous, so a caller may default to it without hiding anything.
 */
export async function classifiedPostCounts(
  db: Database,
  monitorIds?: readonly string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({ monitorId: modelCalls.monitorId, posts: countDistinct(modelCalls.postId) })
    .from(modelCalls)
    .where(
      and(
        eq(modelCalls.purpose, "classification"),
        isNotNull(modelCalls.monitorId),
        isNotNull(modelCalls.postId),
        monitorIds && monitorIds.length > 0
          ? inArray(modelCalls.monitorId, [...monitorIds])
          : undefined,
      ),
    )
    .groupBy(modelCalls.monitorId);

  return new Map(
    rows
      .filter((row): row is { monitorId: string; posts: number } => row.monitorId !== null)
      .map((row) => [row.monitorId, Number(row.posts)]),
  );
}
