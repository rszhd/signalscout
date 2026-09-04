/**
 * The read side of the inbox.
 *
 * Everything the inbox screen shows comes from here, and none of it is
 * computed in a route or a component. Two of US-011's acceptance lines are the
 * reason. The ordering rule is a product decision that has to be written down
 * in one place, and a rule written in a Fastify handler is a rule the next
 * caller re-invents. And the deletion reconciliation of US-015 sets
 * `matches.hidden`; the inbox is the caller that has to honour it, so the
 * filter is here where every caller gets it, not in the query the screen
 * happens to send.
 *
 * ## The ordering rule
 *
 * A match ranks by `score - 12 * age_in_days`, where the age is the *post's*
 * age and never the row's. A person joins a conversation, not a database row.
 *
 * Twelve points a day is the smallest round number that satisfies the example
 * in US-011's Context: a 96 from three days ago must rank below an 88 from ten
 * minutes ago. Three days costs 36 points, so the 96 ranks 60 and the 88 ranks
 * 88. A day-old 90 ranks with a fresh 78, and after a week almost nothing
 * outranks a fresh match, which is the intent: a week-old thread is closed.
 *
 * The decay is linear rather than exponential because a person has to be able
 * to predict it. "It loses half a point an hour" is a sentence somebody can
 * hold; a half-life is not.
 *
 * Age is clamped at zero. A post dated in the future is a clock difference at
 * the source, and it must not rank above its own score.
 *
 * ## Why the clock is a parameter
 *
 * `asOf` is passed in and defaults to now. Page two is then ranked against the
 * same clock as page one, so a match cannot move between pages while somebody
 * reads. Pagination is keyset, on the rank and the id together: an offset over
 * a rank that moves with the clock skips rows, and the failure looks like a
 * match that was never delivered.
 */
import { and, desc, eq, gte, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type IntentType, matches, monitors, posts, type Source } from "../db/schema.js";
import { intentTypeLabel } from "../monitors/signals.js";

/**
 * How many points of score one day of age is worth.
 *
 * Read the file header before changing it. The number is derived from the
 * worked example in US-011, and moving it changes which matches a person sees
 * first, which is the whole product.
 */
export const rankDecayPointsPerDay = 12;

/** One page, unless the caller asks for fewer. */
export const defaultPageSize = 50;

/**
 * The largest page anybody may ask for.
 *
 * The screen renders a page at a time and the API is public to the browser, so
 * this is the ceiling on one query's work rather than a preference.
 */
export const maximumPageSize = 200;

/** The shape the cursor takes: a rank and the id it belongs to. */
export const cursorPattern = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?:[0-9a-fA-F-]{36}$/;

/** One match, with the post it is about and the monitor that found it. */
export interface InboxMatch {
  readonly id: string;
  readonly monitorId: string;
  readonly monitorName: string;
  /** The lead score, 0 to 100, exactly as the classifier wrote it. */
  readonly score: number;
  /** The score after the age decay above. What the list is ordered by. */
  readonly rank: number;
  readonly relevance: number;
  readonly problemFit: number;
  readonly icpFit: number;
  readonly intent: number;
  readonly urgency: number;
  readonly intentType: IntentType;
  /** The same words the monitor form put on the checkbox. `signals.ts` owns them. */
  readonly intentLabel: string;
  /** Specific claims about this post. The part that is not a keyword alert. */
  readonly reasons: readonly string[];
  readonly saved: boolean;
  readonly readAt: Date | null;
  readonly source: Source;
  /** The subreddit on Reddit, null on X where the author is the context. */
  readonly channel: string | null;
  readonly author: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  /** The original conversation. The inbox opens it in a new tab. */
  readonly url: string;
  readonly postedAt: Date;
}

export interface ListMatchesOptions {
  /** One monitor, or every monitor when undefined. */
  readonly monitorId?: string;
  /** The lowest score to show. The monitor's own `min_score` already applied. */
  readonly minScore?: number;
  /** The clock every rank on this page is measured against. */
  readonly asOf?: Date;
  readonly limit?: number;
  /** `nextCursor` from the page before, or null for the first page. */
  readonly cursor?: string | null;
}

export interface MatchPage {
  readonly matches: readonly InboxMatch[];
  /** Null when this was the last page. */
  readonly nextCursor: string | null;
  /** The clock this page was ranked against. The next page must reuse it. */
  readonly asOf: Date;
}

/** Thrown when a cursor did not come from `nextCursor`. */
export class UnusableCursorError extends Error {
  constructor(cursor: string) {
    super(`"${cursor}" is not a cursor this list issued.`);
    this.name = "UnusableCursorError";
  }
}

interface Cursor {
  readonly rank: number;
  readonly id: string;
}

function parseCursor(cursor: string): Cursor {
  if (!cursorPattern.test(cursor)) throw new UnusableCursorError(cursor);

  const separator = cursor.lastIndexOf(":");
  const rank = Number(cursor.slice(0, separator));

  if (!Number.isFinite(rank)) throw new UnusableCursorError(cursor);

  return { rank, id: cursor.slice(separator + 1) };
}

/**
 * The rank, as SQL.
 *
 * `double precision` and not `numeric`: node-postgres hands a float8 back as a
 * JavaScript number, and a number is what the cursor round-trips. The shortest
 * decimal form of a double parses back to the same double, so a cursor built
 * from one page finds the same boundary row on the next.
 */
function rankExpression(asOf: Date): SQL<number> {
  return sql<number>`(${matches.score}::double precision - ${rankDecayPointsPerDay}::double precision
    * GREATEST(0, EXTRACT(EPOCH FROM (${asOf}::timestamptz - ${posts.postedAt})) / 86400.0))`;
}

/** The cursor for a row, so the next page starts after it. */
export function cursorFor(match: InboxMatch): string {
  return `${match.rank}:${match.id}`;
}

/**
 * One page of the inbox, highest rank first.
 *
 * Hidden matches are never returned. US-015 sets that column when the author
 * removed the post, and Reddit's terms are not satisfied by a screen that
 * merely stops linking to it.
 */
export async function listMatches(
  db: Database,
  options: ListMatchesOptions = {},
): Promise<MatchPage> {
  const asOf = options.asOf ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? defaultPageSize, 1), maximumPageSize);
  const rank = rankExpression(asOf);

  const conditions: SQL[] = [eq(matches.hidden, false)];

  if (options.monitorId) conditions.push(eq(matches.monitorId, options.monitorId));
  if (options.minScore !== undefined) conditions.push(gte(matches.score, options.minScore));

  if (options.cursor) {
    const after = parseCursor(options.cursor);
    // The same expression the ordering uses. Postgres cannot see an output
    // alias from `WHERE`, and repeating it is cheaper than the subquery that
    // would let us name it once.
    const boundary = or(
      sql`${rank} < ${after.rank}::double precision`,
      and(sql`${rank} = ${after.rank}::double precision`, sql`${matches.id} < ${after.id}::uuid`),
    );

    if (boundary) conditions.push(boundary);
  }

  // One more than asked for. The extra row is the answer to "is there another
  // page", and it is never returned.
  const rows = await db
    .select({
      id: matches.id,
      monitorId: matches.monitorId,
      monitorName: monitors.name,
      score: matches.score,
      rank,
      relevance: matches.relevance,
      problemFit: matches.problemFit,
      icpFit: matches.icpFit,
      intent: matches.intent,
      urgency: matches.urgency,
      intentType: matches.intentType,
      reasons: matches.reasons,
      saved: matches.saved,
      readAt: matches.readAt,
      source: posts.source,
      channel: posts.channel,
      author: posts.author,
      title: posts.title,
      excerpt: posts.excerpt,
      url: posts.url,
      postedAt: posts.postedAt,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .innerJoin(monitors, eq(matches.monitorId, monitors.id))
    .where(and(...conditions))
    .orderBy(desc(rank), desc(matches.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map((row) => ({
    ...row,
    rank: Number(row.rank),
    intentLabel: intentTypeLabel(row.intentType),
  }));
  const last = page.at(-1);

  return {
    matches: page,
    nextCursor: rows.length > limit && last ? cursorFor(last) : null,
    asOf,
  };
}
