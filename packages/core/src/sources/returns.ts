/**
 * What each connector actually brought back, from this deployment's own rows.
 *
 * US-059. The pricing page's second half: `pricePerUnitMicros` says what a
 * provider charges and this says what the money bought. Both halves are needed
 * to answer the question the owner asked — value rather than price — and
 * neither is combined into a score, because on this instance's own data a
 * score built from the match rate ranks the worse LinkedIn provider three
 * times higher.
 *
 * It lives in core rather than in the API for the reason every query does: the
 * API imports no `drizzle-orm`, and `packages/core` is where the database is
 * reached. The route reads this and shapes it for a screen.
 */
import { eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { feedback, matches, posts } from "../db/schema.js";

/** One platform-and-provider pair, and what it returned. */
export interface ProviderReturn {
  readonly source: string;
  readonly provider: string;
  /** Rows in `posts` collected through this pair. */
  readonly posts: number;
  /** How many of them the classifier scored above the monitor's threshold. */
  readonly matches: number;
  /**
   * The median age of those posts, in hours, at the moment this was read.
   *
   * A median rather than a mean: one post from 2021 in a page of thirty from
   * this morning moves a mean by years and a median not at all, and freshness
   * is the figure this column exists to show.
   */
  readonly medianAgeHours: number | null;
}

/**
 * Count what every pair collected and how much of it matched.
 *
 * One query rather than one per row. It counts rows in `posts`, not anything a
 * connector reported: this is what is in the table, which is what a person can
 * check for themselves.
 *
 * **Rows with no provider are excluded.** `posts.provider` is null on
 * everything collected before US-024 split the platform from the provider —
 * 126 Reddit posts on the development instance. They belong to no pair, and
 * attributing them to whichever provider is listed first would credit one
 * provider with another's work.
 */
export async function providerReturns(db: Database): Promise<ProviderReturn[]> {
  const rows = await db
    .select({
      source: posts.source,
      provider: posts.provider,
      posts: sql<number>`count(distinct ${posts.id})::int`,
      matches: sql<number>`count(distinct ${matches.id})::int`,
      medianAgeHours: sql<
        number | null
      >`extract(epoch from percentile_cont(0.5) within group (order by now() - ${posts.postedAt})) / 3600.0`,
    })
    .from(posts)
    .leftJoin(matches, eq(matches.postId, posts.id))
    .where(isNotNull(posts.provider))
    .groupBy(posts.source, posts.provider);

  return rows.map((row) => ({
    source: String(row.source),
    provider: String(row.provider),
    posts: Number(row.posts ?? 0),
    matches: Number(row.matches ?? 0),
    medianAgeHours:
      row.medianAgeHours === null || row.medianAgeHours === undefined
        ? null
        : Number(row.medianAgeHours),
  }));
}

/**
 * How many verdicts this instance holds.
 *
 * The number that says how far to trust every other number here. A match is
 * the classifier's guess and a verdict is a person's judgement, so "cost per
 * good lead" needs verdicts and not matches — and with five of them on one
 * monitor it is not a figure anybody may compute yet. US-033.
 */
export async function verdictCount(db: Database): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(feedback);
  return Number(row?.count ?? 0);
}
