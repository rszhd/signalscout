/**
 * One row per run of a stage after the poll, written by the stage. US-201.
 *
 * `poll-runs.ts` is the model and its reasoning carries over whole: a stage
 * that ran and did nothing, and a stage that never ran, leave the same absence
 * of rows. Two of these stages spend money, so the difference between "the
 * classifier stopped at the cap with five posts left" and "nobody is talking"
 * is a difference a person pays for and could not see.
 *
 * Two rules travel with the table and are kept here rather than at the call
 * sites.
 *
 * **Every exit writes a row, including the exits that do nothing.** A filter
 * handed no posts, a classifier with no model, a notifier with nothing to
 * send: those are the runs a person needs explained, exactly as US-104 found
 * for the poll's six silent exits.
 *
 * **A failure writes its row before it throws.** The queue retries the job and
 * the retry cannot say what the attempt before it did.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  monitors,
  type StageName,
  type StageOutcome,
  type StageRunDetail,
  type StageStopReason,
  stageRuns,
} from "../db/schema.js";

/** How many stage runs a screen may ask for at once. */
export const maxStageRunsRead = 100;

/**
 * How many rows one monitor keeps.
 *
 * Four stages run for one poll, so this is `pollRunsKeptPerMonitor` times the
 * number of stages: the same span of history on one screen, whichever table a
 * line came from. A monitor at the sixty-second floor writes about six
 * thousand rows a day without a bound.
 */
export const stageRunsKeptPerMonitor = 800;

export interface StageRunRecord {
  readonly monitorId: string;
  readonly userId: string;
  readonly stage: StageName;
  /** The collection it was part of, or null. US-203. */
  readonly walkId?: string | null;
  /** The poll inside that collection whose posts it processed. US-211. */
  readonly pollRunId?: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcome: StageOutcome;
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly units?: number;
  readonly estimatedCostMicros?: number;
  readonly detail?: StageRunDetail | null;
  readonly stopReason?: StageStopReason | null;
}

export interface StageRun
  extends Omit<StageRunRecord, "units" | "estimatedCostMicros" | "walkId" | "pollRunId"> {
  readonly id: string;
  readonly walkId: string | null;
  readonly pollRunId: string | null;
  readonly units: number;
  readonly estimatedCostMicros: number;
  readonly detail: StageRunDetail | null;
  readonly stopReason: StageStopReason | null;
}

/**
 * Write the row, and trim the monitor's oldest.
 *
 * The trim is here for the reason `recordPollRun`'s is: a job that runs
 * somewhere else is a job that can be switched off, and then the table grows
 * with nobody watching.
 *
 * **It never throws.** This is a record of the work and not the work, and a
 * classifier that scored twelve posts must not fail its job — and be retried
 * against the same provider, for money — because writing a history row did
 * not. A failure to record is logged by the caller and lost, which is the
 * cheaper of the two mistakes.
 */
export async function recordStageRun(
  db: Database,
  record: StageRunRecord,
): Promise<StageRun | null> {
  const [row] = await db
    .insert(stageRuns)
    .values({
      monitorId: record.monitorId,
      userId: record.userId,
      stage: record.stage,
      walkId: record.walkId ?? null,
      pollRunId: record.pollRunId ?? null,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      outcome: record.outcome,
      itemsIn: record.itemsIn,
      itemsOut: record.itemsOut,
      units: record.units ?? 0,
      estimatedCostMicros: record.estimatedCostMicros ?? 0,
      detail: record.detail ?? null,
      stopReason: record.stopReason ?? null,
    })
    .returning();

  if (!row) return null;

  await db.execute(sql`
    DELETE FROM ${stageRuns}
    WHERE monitor_id = ${record.monitorId}
      AND id NOT IN (
        SELECT id FROM ${stageRuns}
        WHERE monitor_id = ${record.monitorId}
        ORDER BY started_at DESC
        LIMIT ${stageRunsKeptPerMonitor}
      )
  `);

  return toStageRun(row);
}

/**
 * A monitor's recent stage runs, newest first, for one account.
 *
 * The owner is an argument rather than something this reads from the monitor,
 * which is BUG-009's lesson stated in a signature: a caller cannot forget to
 * scope a read it cannot perform unscoped.
 *
 * `before` is the page cursor: rows that started strictly before that instant.
 * A screen that has read the first page hands back the oldest `startedAt` it
 * holds and gets the next one. Absent means the newest page. US-266.
 */
export async function readStageRuns(
  db: Database,
  userId: string,
  monitorId: string,
  limit = maxStageRunsRead,
  before?: Date,
): Promise<StageRun[]> {
  const [owned] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1);

  if (!owned) return [];

  const rows = await db
    .select()
    .from(stageRuns)
    .where(
      and(
        eq(stageRuns.monitorId, monitorId),
        eq(stageRuns.userId, userId),
        before ? lt(stageRuns.startedAt, before) : undefined,
      ),
    )
    .orderBy(desc(stageRuns.startedAt))
    .limit(Math.min(limit, maxStageRunsRead));

  return rows.map(toStageRun);
}

function toStageRun(row: typeof stageRuns.$inferSelect): StageRun {
  return {
    id: row.id,
    monitorId: row.monitorId,
    userId: row.userId,
    stage: row.stage,
    walkId: row.walkId ?? null,
    pollRunId: row.pollRunId ?? null,
    startedAt: row.startedAt,
    // The column is nullable because a row could be written at the start of a
    // run one day. Nothing writes one yet, so a null here reads as "it ended
    // when it started" rather than as a stage that is somehow still running.
    finishedAt: row.finishedAt ?? row.startedAt,
    outcome: row.outcome,
    itemsIn: row.itemsIn,
    itemsOut: row.itemsOut,
    units: row.units,
    estimatedCostMicros: row.estimatedCostMicros,
    detail: row.detail ?? null,
    stopReason: row.stopReason ?? null,
  };
}
