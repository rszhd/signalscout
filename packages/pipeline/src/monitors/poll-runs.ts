/**
 * One row per poll, written by the poll step and read by a screen. US-104.
 *
 * The ticket's evidence is the reason this module exists rather than a query
 * over the tables that were already there. On 2026-09-09 a monitor on the
 * production instance polled fifteen times, billed $0.666 and stored no post.
 * `api_usage` held the spend, `posts` held nothing, and neither says what a
 * *poll* did — a poll that collected fifty posts this instance already had and
 * a poll that collected nothing leave the same absence of rows.
 *
 * Two rules travel with the table and are enforced here rather than at the
 * call sites.
 *
 * **Every poll writes exactly one row, including the polls that do nothing.**
 * `collect.ts` has eight exits and six of them return without asking a
 * provider anything. Those are the polls a person needs explained.
 *
 * **A walk is not a job.** A paging collection resumes itself through the
 * queue, so one collection is several poll jobs — fifteen of them in the
 * production run. `walkFor` is what groups them, so a screen shows one
 * collection rather than fifteen failures.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  monitors,
  type PollOutcome,
  type PollRunSource,
  type PollStopReason,
  pollRuns,
} from "../db/schema.js";

/** How many polls a screen may ask for at once. */
export const maxPollRunsRead = 50;

/**
 * How many rows one monitor keeps.
 *
 * A monitor at the 60-second floor writes 1,440 rows a day, so the table needs
 * a bound or it becomes the largest one here. Fifty is what the screen shows,
 * and two hundred is enough that a person looking on Monday can still read
 * what happened over a weekend.
 */
export const pollRunsKeptPerMonitor = 200;

export interface PollRunRecord {
  readonly monitorId: string;
  readonly userId: string;
  readonly walkId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcome: PollOutcome;
  readonly postsReturned: number;
  readonly postsNew: number;
  readonly units: number;
  readonly estimatedCostMicros: number;
  readonly sources: readonly PollRunSource[];
  readonly stopReason: PollStopReason | null;
}

export interface PollRun extends PollRunRecord {
  readonly id: string;
}

/**
 * Which collection this poll belongs to.
 *
 * A poll that finds no collection in flight is the start of one, and mints an
 * id. A poll that resumes one continues whatever the monitor's previous poll
 * was part of. There is no state to open or close, so a walk cannot be left
 * open by a job that died: the answer is derived from the rows every time.
 *
 * The fallback matters on exactly one poll — the first one after this table
 * existed, where a monitor has a continuation from before and no row to
 * inherit from. It starts a walk of its own rather than refusing.
 */
export async function walkFor(db: Database, monitorId: string, resuming: boolean): Promise<string> {
  if (!resuming) return crypto.randomUUID();

  const [previous] = await db
    .select({ walkId: pollRuns.walkId })
    .from(pollRuns)
    .where(eq(pollRuns.monitorId, monitorId))
    .orderBy(desc(pollRuns.startedAt))
    .limit(1);

  return previous?.walkId ?? crypto.randomUUID();
}

/**
 * Write the row, and trim the monitor's oldest.
 *
 * The trim is here rather than on a schedule for the reason the row itself is
 * written here: a job that runs somewhere else is a job that can be switched
 * off, and then the table grows with nobody watching. It costs one delete
 * against an indexed column per poll.
 */
export async function recordPollRun(db: Database, record: PollRunRecord): Promise<PollRun> {
  const [row] = await db
    .insert(pollRuns)
    .values({
      monitorId: record.monitorId,
      userId: record.userId,
      walkId: record.walkId,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      outcome: record.outcome,
      postsReturned: record.postsReturned,
      postsNew: record.postsNew,
      units: record.units,
      estimatedCostMicros: record.estimatedCostMicros,
      sources: [...record.sources],
      stopReason: record.stopReason,
    })
    .returning();

  if (!row) throw new Error("The poll run was not recorded.");

  await db.execute(sql`
    DELETE FROM ${pollRuns}
    WHERE monitor_id = ${record.monitorId}
      AND id NOT IN (
        SELECT id FROM ${pollRuns}
        WHERE monitor_id = ${record.monitorId}
        ORDER BY started_at DESC
        LIMIT ${pollRunsKeptPerMonitor}
      )
  `);

  return toPollRun(row);
}

/**
 * A monitor's recent polls, newest first, for one account.
 *
 * The owner is an argument rather than something this reads from the monitor,
 * which is BUG-009's lesson stated in a signature: a caller cannot forget to
 * scope a read it cannot perform unscoped. The monitor is checked here too, so
 * an id belonging to somebody else answers with nothing rather than with rows.
 */
export async function readPollRuns(
  db: Database,
  userId: string,
  monitorId: string,
  limit = maxPollRunsRead,
): Promise<PollRun[]> {
  const [owned] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1);

  if (!owned) return [];

  const rows = await db
    .select()
    .from(pollRuns)
    .where(and(eq(pollRuns.monitorId, monitorId), eq(pollRuns.userId, userId)))
    .orderBy(desc(pollRuns.startedAt))
    .limit(Math.min(limit, maxPollRunsRead));

  return rows.map(toPollRun);
}

/** The most recent poll of each of several monitors, for the list screen. */
export async function latestPollRuns(
  db: Database,
  userId: string,
  monitorIds: readonly string[],
): Promise<Map<string, PollRun>> {
  if (monitorIds.length === 0) return new Map();

  /**
   * One statement rather than one per monitor.
   *
   * The list screen holds every monitor an account has, and a query per card
   * is the shape that reads fine with three monitors and stops the page with
   * thirty.
   */
  const rows = await db
    .select()
    .from(pollRuns)
    .where(
      and(
        eq(pollRuns.userId, userId),
        inArray(pollRuns.monitorId, [...monitorIds]),
        sql`${pollRuns.startedAt} = (
          SELECT max(started_at) FROM ${pollRuns} AS latest
          WHERE latest.monitor_id = ${pollRuns.monitorId}
        )`,
      ),
    );

  return new Map(rows.map((row) => [row.monitorId, toPollRun(row)]));
}

function toPollRun(row: typeof pollRuns.$inferSelect): PollRun {
  return {
    id: row.id,
    monitorId: row.monitorId,
    userId: row.userId,
    walkId: row.walkId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? row.startedAt,
    outcome: row.outcome,
    postsReturned: row.postsReturned,
    postsNew: row.postsNew,
    units: row.units,
    estimatedCostMicros: row.estimatedCostMicros,
    sources: row.sources,
    stopReason: row.stopReason ?? null,
  };
}
