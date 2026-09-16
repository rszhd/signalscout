/**
 * Correctness-critical: a feedback export must not expose a deleted title.
 * worker/reconcile.test.ts asserts this while preserving verdict history.
 *
 * What the user thought of a match.
 *
 * US-012 collects the answer and does not use it yet, on purpose. Two buttons
 * on every match, stored with the monitor and the version of it that was
 * judged. Using the verdicts to improve scoring is a later ticket, and a
 * learning loop with nothing to learn from is speculation.
 *
 * ## The rows are history, not a setting
 *
 * A verdict is never updated in place. Changing one supersedes the row that
 * was in force and inserts a new one, so the table can answer "what did this
 * person think, and when" rather than only "what do they think now". The
 * partial unique index in the schema is what makes "one verdict per match per
 * user" true while the history grows underneath it.
 *
 * Re-sending the verdict that is already in force writes nothing. A second
 * press of the same button is not a change of mind, and a history that
 * recorded it as one would report a person who clicked twice as a person who
 * changed their answer.
 *
 * ## Why the version travels with the verdict
 *
 * `monitors.version` counts edits to the definition the classifier judges
 * against. A verdict carries the version that was in force when it was given,
 * because "this is a good lead" is an answer to a question, and the question
 * is the monitor. Replayed against a monitor that has since been rewritten, it
 * teaches the wrong lesson. Nothing replays them yet; the column is what makes
 * it possible to do that safely later.
 */
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { feedback, matches, monitors, posts, type Verdict } from "../db/schema.js";

/** A verdict as the caller gives it. */
export interface RecordVerdictInput {
  readonly matchId: string;
  readonly verdict: Verdict;
  /** Who gave the verdict. Required since US-017; there is no default owner. */
  readonly userId: string;
}

/** The verdict now in force, after the write. */
export interface RecordedVerdict {
  readonly id: string;
  readonly matchId: string;
  readonly monitorId: string;
  readonly monitorVersion: number;
  readonly userId: string;
  readonly verdict: Verdict;
  readonly createdAt: Date;
  /**
   * True when this replaced a different verdict, false when it is the first
   * one or a repeat of the one already in force. The route says nothing
   * different either way; a caller that wants to count changes has it here
   * rather than by reading the history back.
   */
  readonly changed: boolean;
}

/**
 * Give a verdict, or change the one already given.
 *
 * Undefined when no match has that id, so a route can answer 404 instead of
 * writing a verdict about nothing.
 *
 * One transaction, because superseding the old row and inserting the new one
 * is one decision. Half of it applied would leave either two verdicts in force
 * — which the unique index refuses — or none, which reads as a person who
 * never answered.
 */
export async function recordVerdict(
  db: Database,
  input: RecordVerdictInput,
): Promise<RecordedVerdict | undefined> {
  const userId = input.userId;

  return db.transaction(async (tx) => {
    const [match] = await tx
      .select({ monitorId: matches.monitorId, version: monitors.version })
      .from(matches)
      .innerJoin(monitors, eq(matches.monitorId, monitors.id))
      .where(eq(matches.id, input.matchId))
      .limit(1);

    if (!match) return undefined;

    const [current] = await tx
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.matchId, input.matchId),
          eq(feedback.userId, userId),
          isNull(feedback.supersededAt),
        ),
      )
      .limit(1);

    if (current && current.verdict === input.verdict) {
      return {
        id: current.id,
        matchId: current.matchId,
        monitorId: current.monitorId,
        monitorVersion: current.monitorVersion,
        userId: current.userId,
        verdict: current.verdict,
        createdAt: current.createdAt,
        changed: false,
      };
    }

    if (current) {
      await tx
        .update(feedback)
        .set({ supersededAt: new Date() })
        .where(eq(feedback.id, current.id));
    }

    const [row] = await tx
      .insert(feedback)
      .values({
        matchId: input.matchId,
        monitorId: match.monitorId,
        // The version now, not the version the match was scored under. A
        // verdict is what the person thinks of the monitor they are looking
        // at today.
        monitorVersion: match.version,
        userId,
        verdict: input.verdict,
      })
      .returning();

    if (!row) throw new Error("The verdict was not inserted.");

    return {
      id: row.id,
      matchId: row.matchId,
      monitorId: row.monitorId,
      monitorVersion: row.monitorVersion,
      userId: row.userId,
      verdict: row.verdict,
      createdAt: row.createdAt,
      changed: current !== undefined,
    };
  });
}

/**
 * The verdict in force on each of these matches, for one user.
 *
 * A match nobody has judged is absent from the map. Absent is the honest
 * answer: "no verdict" is not a third verdict, and a caller that defaulted it
 * to one would show a button as pressed.
 */
export async function currentVerdicts(
  db: Database,
  matchIds: readonly string[],
  userId: string,
): Promise<Map<string, Verdict>> {
  if (matchIds.length === 0) return new Map();

  const rows = await db
    .select({ matchId: feedback.matchId, verdict: feedback.verdict })
    .from(feedback)
    .where(
      and(
        inArray(feedback.matchId, [...matchIds]),
        eq(feedback.userId, userId),
        isNull(feedback.supersededAt),
      ),
    );

  return new Map(rows.map((row) => [row.matchId, row.verdict]));
}

/** How many verdicts of each kind one monitor holds. */
export interface VerdictCounts {
  readonly good: number;
  readonly notRelevant: number;
}

export const noVerdicts: VerdictCounts = { good: 0, notRelevant: 0 };

/**
 * Every named monitor's counts, or every monitor's, in one read.
 *
 * Only the verdicts in force are counted. A person who marked a match good and
 * then changed their mind has one verdict, not two, and a monitor list that
 * counted the history would report the number of times somebody pressed a
 * button.
 *
 * A monitor with no verdicts is absent rather than present with zeros, and a
 * caller may default to `noVerdicts` without hiding anything: zero here means
 * nobody has judged this monitor's matches, which is what zero says.
 */
export async function verdictCounts(
  db: Database,
  monitorIds?: readonly string[],
): Promise<Map<string, VerdictCounts>> {
  const rows = await db
    .select({ monitorId: feedback.monitorId, verdict: feedback.verdict, given: count() })
    .from(feedback)
    .where(
      and(
        isNull(feedback.supersededAt),
        monitorIds && monitorIds.length > 0
          ? inArray(feedback.monitorId, [...monitorIds])
          : undefined,
      ),
    )
    .groupBy(feedback.monitorId, feedback.verdict);

  const counts = new Map<string, { good: number; notRelevant: number }>();

  for (const row of rows) {
    const entry = counts.get(row.monitorId) ?? { good: 0, notRelevant: 0 };
    if (row.verdict === "good") entry.good = Number(row.given);
    else entry.notRelevant = Number(row.given);
    counts.set(row.monitorId, entry);
  }

  return counts;
}

/**
 * One exported verdict.
 *
 * The ids are here so an export can be read back into the instance it came
 * from, and the source, external id and URL are here so it means something in
 * an instance it did not. US-012 asks for feedback that survives a reinstall,
 * and a row of foreign keys into a database that no longer exists does not.
 */
export interface ExportedVerdict {
  readonly matchId: string;
  readonly monitorId: string;
  readonly monitorName: string;
  readonly monitorVersion: number;
  readonly userId: string;
  readonly verdict: Verdict;
  readonly score: number;
  readonly source: string;
  /** The id the source gave the post. With `source`, the post's stable identity. */
  readonly externalId: string;
  readonly url: string;
  readonly title: string | null;
  readonly createdAt: Date;
  /** Set on a verdict the person later changed. Null on the one in force. */
  readonly supersededAt: Date | null;
}

/**
 * Every verdict this instance holds, newest first, history included.
 *
 * The superseded rows are exported too. An export that held only the current
 * answers would lose the part that took time to collect — that somebody
 * changed their mind, and when.
 */
export async function exportFeedback(db: Database, userId: string): Promise<ExportedVerdict[]> {
  return db
    .select({
      matchId: feedback.matchId,
      monitorId: feedback.monitorId,
      monitorName: monitors.name,
      monitorVersion: feedback.monitorVersion,
      userId: feedback.userId,
      verdict: feedback.verdict,
      score: matches.score,
      source: posts.source,
      externalId: posts.externalId,
      url: posts.url,
      // Feedback history survives deletion, but the removed title is content.
      title: sql<
        string | null
      >`CASE WHEN ${matches.hidden} OR ${posts.deletedAt} IS NOT NULL THEN NULL ELSE ${posts.title} END`,
      createdAt: feedback.createdAt,
      supersededAt: feedback.supersededAt,
    })
    .from(feedback)
    .innerJoin(matches, eq(feedback.matchId, matches.id))
    .innerJoin(posts, eq(matches.postId, posts.id))
    .innerJoin(monitors, eq(feedback.monitorId, monitors.id))
    .where(eq(feedback.userId, userId))
    .orderBy(desc(feedback.createdAt), desc(feedback.id));
}
