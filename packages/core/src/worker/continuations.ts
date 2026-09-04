/**
 * Collections that were started at a source and have not been read yet.
 *
 * Correctness-critical: cursor and deduplication. The failure this file exists
 * to prevent is BUG-001, seen live: a source answers a poll with
 * `next.status === "wait"` and a cursor, the job ends, and the cursor goes with
 * it. On Bright Data the collection is billed when it is triggered, so a lost
 * cursor is money spent on records nobody reads — and the next poll pays again
 * for the same query.
 *
 * The row is the durable fact; the poll job the collector books afterwards is
 * only an alarm clock. That order is what makes the guarantee hold when the
 * queue refuses the job or the process dies before it is sent: the next poll
 * still finds the row and reads the snapshot instead of starting a second one.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type Source, sourceContinuations } from "../db/schema.js";

/** One collection in flight, as the poll step needs it. */
export interface Continuation {
  readonly source: Source;
  /** Opaque. It came from the connector that issued it and means nothing here. */
  readonly cursor: string;
  /** The `since` of the poll that triggered the collection. */
  readonly since?: Date;
  readonly resumeAfter: Date;
  /** Resumes in a row that brought back nothing. Progress resets it. */
  readonly attempts: number;
}

export async function continuationsFor(
  db: Database,
  monitorId: string,
): Promise<readonly Continuation[]> {
  const rows = await db
    .select()
    .from(sourceContinuations)
    .where(eq(sourceContinuations.monitorId, monitorId));

  return rows.map((row) => ({
    source: row.source,
    cursor: row.cursor,
    ...(row.since ? { since: row.since } : {}),
    resumeAfter: row.resumeAfter,
    attempts: row.attempts,
  }));
}

export interface ContinuationRecord {
  readonly source: Source;
  readonly cursor: string;
  readonly since?: Date;
  readonly resumeAfter: Date;
  /** Did this read bring anything back? A read that did clears the count. */
  readonly progressed: boolean;
}

/**
 * Record where this source got to, and when it may be asked again.
 *
 * `since` is written once and never updated. The window belongs to the poll
 * that triggered the collection, and a resume that widened or narrowed it
 * would be reading a snapshot with a question it was not collected for.
 *
 * `attempts` counts resumes in a row that brought nothing back, and a resume
 * that returned posts sets it to zero. Counting every resume instead would
 * abandon a long collection that was being read a page at a time, which is the
 * opposite of what the cap is for: it exists to stop a collection that never
 * becomes ready, not one that is working.
 */
export async function rememberContinuation(
  db: Database,
  monitorId: string,
  { source, cursor, since, resumeAfter, progressed }: ContinuationRecord,
): Promise<void> {
  await db
    .insert(sourceContinuations)
    .values({ monitorId, source, cursor, since: since ?? null, resumeAfter })
    .onConflictDoUpdate({
      target: [sourceContinuations.monitorId, sourceContinuations.source],
      set: {
        cursor,
        resumeAfter,
        attempts: progressed ? 0 : sql`${sourceContinuations.attempts} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/** The collection is read, abandoned, or withdrawn by the source. */
export async function forgetContinuation(
  db: Database,
  monitorId: string,
  source: Source,
): Promise<void> {
  await db
    .delete(sourceContinuations)
    .where(
      and(eq(sourceContinuations.monitorId, monitorId), eq(sourceContinuations.source, source)),
    );
}
