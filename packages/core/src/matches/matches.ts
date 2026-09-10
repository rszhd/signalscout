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
 * ## The other orders
 *
 * The rank is the default and not the only one. US-114 added the two halves it
 * is made of: the score alone, and the date alone. The rank mixes them at
 * twelve points a day, which answers "what should I read next" and answers the
 * other two questions badly — "what are the best leads this monitor has ever
 * found" and "what arrived since I last looked". Under the rank a fresh low
 * score and an old high one land on the same rung, so both answers are
 * scattered through one list. The saved list of US-043 has a fourth order, by
 * when a thing was kept.
 *
 * All three go through `orderValue`, which is the one place a page's ordering
 * is decided. The sort and the keyset cursor read the same expression, so they
 * cannot disagree — and they did disagree before US-114: the saved list sorted
 * by `saved_at` and paged on the rank, which dropped rows from page two.
 * Each row carries the cursor that resumes after it, in its own ordering,
 * because a cursor built anywhere else is a second way to build one.
 *
 * ## What a verdict does to the list
 *
 * A match the user marked not relevant leaves the default view and stays in
 * the table. US-012 is firm that it is not deleted: the verdict is the data
 * the feedback loop is being collected for, and a row that was removed to
 * tidy a screen cannot teach anything later. `includeNotRelevant` is how a
 * person looks at what they dismissed.
 *
 * The verdict is read here rather than by a second query from the screen, for
 * the reason the hidden filter is here: both are the same question about the
 * same page, and a caller that asked separately could show a page whose
 * buttons disagree with its rows.
 *
 * ## Why the clock is a parameter
 *
 * `asOf` is passed in and defaults to now. Page two is then ranked against the
 * same clock as page one, so a match cannot move between pages while somebody
 * reads. Pagination is keyset, on the rank and the id together: an offset over
 * a rank that moves with the clock skips rows, and the failure looks like a
 * match that was never delivered.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import type { Database } from "../db/client.js";
import {
  feedback,
  type IntentType,
  matches,
  monitors,
  posts,
  type Source,
  type Verdict,
} from "../db/schema.js";

/**
 * `posts` a second time, as the thread above a reply.
 *
 * Named once here rather than inside the query so the two roles cannot be
 * confused when reading it: `posts` is the thing being judged, `parentPost` is
 * its context.
 */
const parentPost = alias(posts, "parent_post");

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

/** The shape the cursor takes: an ordering value and the id it belongs to. */
export const cursorPattern = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?:[0-9a-fA-F-]{36}$/;

/**
 * What a page of the inbox is ordered by. US-114.
 *
 * `rank` is US-011's score minus twelve points a day, and it is the default.
 * The other two are its halves, because the rank mixes them and a person
 * sometimes wants one on its own:
 *
 * - `score` is what the classifier said, with no decay. The best leads this
 *   monitor has ever found, whenever they were written.
 * - `newest` is the post's own date, with no score. What arrived since I last
 *   looked. It is the same date the rank decays against and the same one the
 *   card shows — never `matches.created_at`, which records when a poll got
 *   round to scoring the post and so describes our schedule rather than the
 *   lead.
 *
 * The saved list has an order of its own and it is not offered here: it is not
 * a choice, it is what that list is.
 */
export const matchOrders = ["rank", "score", "newest"] as const;

export type MatchOrder = (typeof matchOrders)[number];

/** The saved list's own order, beside the two a caller may ask for. */
type PageOrder = MatchOrder | "saved";

/** One match, with the post it is about and the monitor that found it. */
export interface InboxMatch {
  readonly id: string;
  readonly monitorId: string;
  readonly monitorName: string;
  /** The lead score, 0 to 100, exactly as the classifier wrote it. */
  readonly score: number;
  /**
   * The score after the age decay above.
   *
   * What the default order sorts by, and reported on every page whatever the
   * order — it is a fact about the match rather than about the list.
   */
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
  /** The verdict this user has in force, or null when they have not judged it. */
  readonly verdict: Verdict | null;
  readonly readAt: Date | null;
  readonly source: Source;
  /** The subreddit on Reddit, null on X where the author is the context. */
  readonly channel: string | null;
  /** "post" or "reply". A reply carries the thread below. US-020. */
  readonly kind: string;
  /** The post a reply hangs under. Null on a post, and on an orphaned reply. */
  readonly parentTitle: string | null;
  readonly parentExcerpt: string | null;
  readonly parentUrl: string | null;
  /**
   * How much of the thread above a reply was read, and why reading ended.
   *
   * US-048. A thread is read fifty comments at a time and abandoned when two
   * batches in a row hold no lead, so a person looking at one comment is
   * looking at a sample of a conversation — and how big a sample, of how much,
   * is not something they can guess.
   *
   * `parentRepliesRead` counts what the provider handed over rather than what
   * was stored, so it is the depth reached and not the harvest.
   * `parentReplyCount` is the platform's own claim about the thread's size.
   * `parentRepliesStopped` is null while a thread is still being read.
   */
  readonly parentRepliesRead: number | null;
  readonly parentReplyCount: number | null;
  readonly parentRepliesStopped: string | null;
  readonly author: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  /** The original conversation. The inbox opens it in a new tab. */
  readonly url: string;
  readonly postedAt: Date;
  /**
   * The cursor that resumes the list after this row. US-114.
   *
   * On the row rather than from a function, because its value depends on the
   * order the page was read in: the rank orders by one number and the newest
   * order by another. A cursor built anywhere but here would be a second
   * answer to that question, free to disagree with the `ORDER BY` — which is
   * exactly how the saved list came to page on a rank it did not sort by.
   */
  readonly cursor: string;
}

export interface ListMatchesOptions {
  /** One monitor, or every monitor when undefined. */
  readonly monitorId?: string;
  /**
   * Every monitor in one project. US-045.
   *
   * A project is a business, so its inbox is the conversations found for that
   * business — one filter wider than a monitor and narrower than everything.
   * It reads `monitors.project_id`, which is where a monitor was created, and
   * a monitor moved out of a project leaves that project's inbox with it.
   *
   * Combined with `monitorId` it narrows further rather than conflicting: a
   * monitor that is not in the project simply matches nothing, which is the
   * honest answer to a contradictory question.
   */
  readonly projectId?: string;
  /** The lowest score to show. The monitor's own `min_score` already applied. */
  readonly minScore?: number;
  /** The clock every rank on this page is measured against. */
  readonly asOf?: Date;
  readonly limit?: number;
  /** `nextCursor` from the page before, or null for the first page. */
  readonly cursor?: string | null;
  /**
   * Whose inbox this is, and whose verdicts to read. US-017.
   *
   * Required, and it used to default to the one self-hosted id. A default is
   * what an unscoped caller gets when it forgets, and here that means one
   * person's inbox answering somebody else's request.
   */
  readonly userId: string;
  /** Show the matches this user marked not relevant. Default false. */
  readonly includeNotRelevant?: boolean;
  /**
   * Only the matches this person kept. US-043.
   *
   * A different list rather than a filter on the same one, and the ordering
   * says why: the inbox ranks by score and age together, subtracting twelve
   * points a day, and something kept on purpose does not get less kept
   * overnight. When this is set the page is ordered by when it was saved, and
   * `order` is ignored.
   */
  readonly savedOnly?: boolean;
  /**
   * What to order the page by. Defaults to the rank. US-114.
   *
   * Ignored on the saved list, which has an order of its own: something kept
   * on purpose does not get less kept overnight, and neither is it kept by the
   * date it was written.
   */
  readonly order?: MatchOrder;
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
  /** Whatever this page was ordered by. `orderValue` decides which number. */
  readonly value: number;
  readonly id: string;
}

function parseCursor(cursor: string): Cursor {
  if (!cursorPattern.test(cursor)) throw new UnusableCursorError(cursor);

  const separator = cursor.lastIndexOf(":");
  const value = Number(cursor.slice(0, separator));

  if (!Number.isFinite(value)) throw new UnusableCursorError(cursor);

  return { value, id: cursor.slice(separator + 1) };
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

/**
 * A timestamp as a number the cursor can carry.
 *
 * `double precision` for `rankExpression`'s reason, and it is enough here: a
 * double holds a second-of-the-epoch to well under a microsecond, and Postgres
 * stores a `timestamptz` to the microsecond. So the boundary row found by a
 * cursor is the row the cursor was built from, and not the one beside it.
 */
function epochOf(column: SQL | AnyPgColumn): SQL<number> {
  return sql<number>`EXTRACT(EPOCH FROM ${column})::double precision`;
}

/**
 * The one number a page is sorted and paged by.
 *
 * Both the `ORDER BY` and the keyset boundary read this, so an order cannot be
 * added to one and forgotten in the other.
 */
function orderValue(order: PageOrder, asOf: Date): SQL<number> {
  if (order === "rank") return rankExpression(asOf);
  if (order === "newest") return epochOf(posts.postedAt);
  // `double precision` like the rest, so one cursor shape carries all four
  // orders and `parseCursor` has one number to read.
  if (order === "score") return sql<number>`${matches.score}::double precision`;

  return epochOf(matches.savedAt);
}

/**
 * One page of the inbox, highest rank first.
 *
 * Hidden matches are never returned. US-015 sets that column when the author
 * removed the post, and Reddit's terms are not satisfied by a screen that
 * merely stops linking to it.
 */
export async function listMatches(db: Database, options: ListMatchesOptions): Promise<MatchPage> {
  const asOf = options.asOf ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? defaultPageSize, 1), maximumPageSize);
  const userId = options.userId;
  const rank = rankExpression(asOf);
  // The saved list wins over the caller's order rather than arguing with it.
  // Its order is what that list is, so there is nothing here to choose.
  const order: PageOrder = options.savedOnly ? "saved" : (options.order ?? "rank");
  const sortBy = orderValue(order, asOf);

  /**
   * The inbox belongs to one person. US-017.
   *
   * On the monitor rather than on the match, because that is where ownership
   * is recorded: a match is a post scored against somebody's monitor, and it
   * belongs to whoever the monitor does. The join is already here for the
   * monitor's name, so this costs nothing.
   */
  const conditions: SQL[] = [eq(matches.hidden, false), eq(monitors.userId, userId)];

  // At most one verdict is in force per match per user — the partial unique
  // index on `feedback` is what guarantees it — so this join cannot turn one
  // match into two rows of a page.
  const currentVerdict = and(
    eq(feedback.matchId, matches.id),
    eq(feedback.userId, userId),
    isNull(feedback.supersededAt),
  );

  if (!options.includeNotRelevant && !options.savedOnly) {
    // `IS DISTINCT FROM` and not `<>`: an unjudged match has no feedback row,
    // so the column is null here, and null compared with `<>` would drop every
    // match nobody has judged yet.
    conditions.push(sql`${feedback.verdict} IS DISTINCT FROM 'not_relevant'`);
  }

  if (options.monitorId) conditions.push(eq(matches.monitorId, options.monitorId));
  if (options.projectId) conditions.push(eq(monitors.projectId, options.projectId));

  /**
   * The saved list. US-043.
   *
   * A different list rather than a filter, because it answers a different
   * question: the inbox asks "what should I read", and this asks "what did I
   * say I would come back to". Kept matches are shown whatever their verdict,
   * including the ones marked not relevant — somebody who judged a match weak
   * and kept it anyway meant both, and hiding it would overrule them.
   */
  if (options.savedOnly) conditions.push(isNotNull(matches.savedAt));
  if (options.minScore !== undefined) conditions.push(gte(matches.score, options.minScore));

  if (options.cursor) {
    const after = parseCursor(options.cursor);
    // The same expression the ordering uses. Postgres cannot see an output
    // alias from `WHERE`, and repeating it is cheaper than the subquery that
    // would let us name it once.
    const boundary = or(
      sql`${sortBy} < ${after.value}::double precision`,
      and(
        sql`${sortBy} = ${after.value}::double precision`,
        sql`${matches.id} < ${after.id}::uuid`,
      ),
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
      sortBy,
      relevance: matches.relevance,
      problemFit: matches.problemFit,
      icpFit: matches.icpFit,
      intent: matches.intent,
      urgency: matches.urgency,
      intentType: matches.intentType,
      reasons: matches.reasons,
      // Derived, so a screen keeps asking one simple question while the
      // column carries the ordering the saved list needs.
      saved: sql<boolean>`${matches.savedAt} is not null`,
      verdict: feedback.verdict,
      readAt: matches.readAt,
      source: posts.source,
      channel: posts.channel,
      author: posts.author,
      title: posts.title,
      excerpt: posts.excerpt,
      url: posts.url,
      postedAt: posts.postedAt,
      kind: posts.kind,
      /**
       * The post above a reply, so a person reads what the model read. US-020.
       *
       * A left self-join rather than a second query: a reply is unreadable on
       * its own — "we hit this too, what did you end up using?" names nothing
       * — and an inbox that showed the reply alone would ask somebody to judge
       * a lead with less context than the classifier had.
       */
      parentTitle: parentPost.title,
      parentExcerpt: parentPost.excerpt,
      parentUrl: parentPost.url,
      parentRepliesRead: parentPost.repliesBatchStart,
      parentReplyCount: parentPost.replyCount,
      parentRepliesStopped: parentPost.repliesStopped,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .leftJoin(parentPost, eq(posts.parentPostId, parentPost.id))
    .innerJoin(monitors, eq(matches.monitorId, monitors.id))
    .leftJoin(feedback, currentVerdict)
    .where(and(...conditions))
    /**
     * Whatever this page is ordered by, then the id.
     *
     * The id is not decoration: two matches share a rank whenever two posts of
     * the same score land in the same instant, and on the newest order two
     * posts from one page of a provider often carry the same timestamp. A
     * keyset cursor over a value that repeats needs a tie-break it can compare,
     * or the second row of the pair is skipped.
     */
    .orderBy(desc(sortBy), desc(matches.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map(({ sortBy: value, ...row }) => ({
    ...row,
    rank: Number(row.rank),
    intentLabel: intentTypeLabel(row.intentType),
    cursor: `${Number(value)}:${row.id}`,
  }));
  const last = page.at(-1);

  return {
    matches: page,
    nextCursor: rows.length > limit && last ? last.cursor : null,
    asOf,
  };
}

/**
 * Keep a match, or stop keeping it. US-043.
 *
 * **This is not a verdict and must not become one.** A verdict is a judgement
 * about the model — was this worth showing me — and `feedback` stores it
 * against the monitor version that earned it, because that is what makes the
 * sample mean anything. Saving is a statement about intent: somebody is going
 * to do something here. They come apart in both directions, and a good catch
 * that needs no reply is as common as a weak match worth answering.
 *
 * So it writes one boolean on the match and touches nothing else. It does not
 * move `monitors.version`, it does not write to `feedback`, and re-classifying
 * a saved match under a new monitor version leaves it saved: the person's
 * intent is theirs, the way their verdict is.
 *
 * Returns undefined when no match has that id, so a caller can answer 404
 * rather than reporting a write that did not happen.
 */
/**
 * Who owns the monitor this match was scored against. US-017.
 *
 * `undefined` for a match that does not exist, so one query answers both
 * questions a route addressed by a match id has to ask.
 *
 * Deliberately *not* folded into `recordVerdict`. `feedback` is one row per
 * match per person on purpose — the schema keeps that so teams are a data
 * change later — and refusing a verdict from anybody but the monitor's owner
 * would take that capability away inside a ticket that defers the screens for
 * it. So the rule lives at the route, where US-017's scoping lives, and the
 * mechanism underneath is unchanged.
 */
export async function matchOwner(db: Database, matchId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: monitors.userId })
    .from(matches)
    .innerJoin(monitors, eq(matches.monitorId, monitors.id))
    .where(eq(matches.id, matchId))
    .limit(1);

  return row?.userId;
}

export async function setMatchSaved(
  db: Database,
  userId: string,
  matchId: string,
  saved: boolean,
  now: Date = new Date(),
): Promise<{ readonly matchId: string; readonly savedAt: Date | null } | undefined> {
  const [row] = await db
    .update(matches)
    // Saving again does not move the time. A list worked through top to bottom
    // would otherwise reshuffle under somebody's cursor when they pressed a
    // button they had already pressed.
    .set({ savedAt: saved ? sql`coalesce(${matches.savedAt}, ${now})` : null })
    // Scoped in the same statement as the write, not checked before it. US-017.
    // A read and then a write is two questions with a gap between them; one
    // `WHERE` cannot be raced, and a match on somebody else's monitor simply
    // updates no row and comes back as the 404 an unknown id already gets.
    .where(
      and(
        eq(matches.id, matchId),
        inArray(
          matches.monitorId,
          db.select({ id: monitors.id }).from(monitors).where(eq(monitors.userId, userId)),
        ),
      ),
    )
    .returning({ id: matches.id, savedAt: matches.savedAt });

  return row ? { matchId: row.id, savedAt: row.savedAt } : undefined;
}

/** How many matches one monitor holds, and how many nobody has opened. US-109. */
export interface MatchCounts {
  readonly total: number;
  readonly unread: number;
}

export const noMatchCounts: MatchCounts = { total: 0, unread: 0 };

/**
 * Every named monitor's match counts, in one read. US-109.
 *
 * The monitor list is what asks. It shows one number per row, so a count per
 * row would be a query per row — the shape that reads fine with three monitors
 * and stops the page with thirty. `verdictCounts` and `filterDropCounts` are
 * the same statement for the same reason.
 *
 * A hidden match is not counted. US-015 hides a match whose post has been
 * deleted, and a number that counted those would promise a person leads that
 * open on nothing.
 *
 * Unread counts the rows with no `read_at`, whatever their verdict. "Sixty
 * found, none read" and "sixty found, all read" send a person to two different
 * places, and one total says neither.
 *
 * A monitor with no matches is absent rather than present with zeros, and a
 * caller may default to `noMatchCounts` without hiding anything: zero here
 * means this monitor has found nothing, which is what zero says.
 */
export async function matchCounts(
  db: Database,
  monitorIds?: readonly string[],
): Promise<Map<string, MatchCounts>> {
  const rows = await db
    .select({
      monitorId: matches.monitorId,
      total: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${matches.readAt} is null)::int`,
    })
    .from(matches)
    .where(
      and(
        eq(matches.hidden, false),
        monitorIds && monitorIds.length > 0
          ? inArray(matches.monitorId, [...monitorIds])
          : undefined,
      ),
    )
    .groupBy(matches.monitorId);

  return new Map(
    rows.map((row) => [row.monitorId, { total: Number(row.total), unread: Number(row.unread) }]),
  );
}
