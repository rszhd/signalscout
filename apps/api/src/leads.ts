/**
 * Where a monitor's leads come from. US-267.
 *
 * A person sets a monitor up once and then has no way to improve it. These
 * readings are what change that, and each one ends in a decision rather than
 * in a feeling:
 *
 * **Platform and channel.** On the instance this was written against, Reddit
 * gave 720 matches at an average of 48 and TikTok gave 47 at 61 — so the
 * quiet platform was the better one, per match. A person reading that adds
 * volume where it works and drops the subreddit that has never produced
 * anything.
 *
 * **Posts against comments.** 711 matches from posts at an average of 48, and
 * 44 from comments at 64. Reading comment threads is the expensive stage and
 * the obvious thing to switch off to save money — and it finds the better
 * leads. This is the clearest case in the product of a number that reverses an
 * instinct, and it was invisible.
 *
 * **Intent.** What kind of conversation the plan actually finds: people asking
 * for a recommendation, people describing a problem, or neither. That is the
 * signals question from setup, answered with evidence.
 *
 * **One floor.** Every count here is of matches at or above the monitor's own
 * `min_score`, with hidden rows left out — the same rule `matchCounts` and
 * `queryPerformance` apply in the package, so the four numbers on the page
 * can be reconciled with each other. The floor travels with the answer.
 *
 * It reads `matches` joined to `posts`, which is why it needs nothing from the
 * packages: the platform, the channel and the kind are columns those two
 * tables already carry.
 */
import {
  type Database,
  type IntentType,
  intentTypeLabel,
  intentTypes,
  matches,
  monitors,
  posts,
} from "@signalscout/pipeline";
import { and, count, desc, eq, gte, max, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export interface LeadGroup {
  /** The platform, the channel, `post`/`reply`, or the intent type. */
  readonly value: string;
  /**
   * The value as a person reads it, where the server holds the words: an
   * intent type's label comes from the engine, so the card and this table
   * cannot drift apart. Elsewhere it is the value itself and the screen
   * names it.
   */
  readonly label: string;
  /** The platform a channel belongs to. Null where the grouping is not a channel. */
  readonly source: string | null;
  readonly matches: number;
  readonly averageScore: number;
  readonly bestScore: number;
  /** Matches at or above 70, which is where a lead is worth interrupting for. */
  readonly strong: number;
}

export interface Leads {
  /** The monitor's `min_score`: what every count below is counted from. */
  readonly floor: number;
  readonly platforms: LeadGroup[];
  readonly channels: LeadGroup[];
  readonly kinds: LeadGroup[];
  readonly intents: LeadGroup[];
}

/**
 * The four groupings, in four statements rather than one.
 *
 * One statement with four `group by`s would be four passes with a union and a
 * discriminator column, which is the same work written so that nobody can read
 * it. These are small reads against an indexed join on one monitor.
 *
 * Null for somebody else's monitor. BUG-009's rule in a signature: a caller
 * cannot forget to scope a read it cannot perform unscoped.
 */
export async function leadsOf(
  db: Database,
  userId: string,
  monitorId: string,
): Promise<Leads | null> {
  const [owned] = await db
    .select({ id: monitors.id, minScore: monitors.minScore })
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1);

  if (!owned) return null;

  const floor = owned.minScore;
  const strong = sql<number>`count(*) filter (where ${matches.score} >= 70)::int`;

  const groupedBy = async (
    column: AnyPgColumn,
    withSource: boolean,
    label: (value: string) => string = (value) => value,
  ) => {
    const rows = await db
      .select({
        value: column,
        source: withSource ? posts.source : sql<string | null>`null`,
        matches: count(),
        averageScore: sql<number>`round(avg(${matches.score}))::int`,
        bestScore: max(matches.score),
        strong,
      })
      .from(matches)
      .innerJoin(posts, eq(posts.id, matches.postId))
      .where(
        and(eq(matches.monitorId, monitorId), eq(matches.hidden, false), gte(matches.score, floor)),
      )
      .groupBy(column, ...(withSource ? [posts.source] : []))
      .orderBy(desc(count()));

    return rows
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: String(row.value),
        label: label(String(row.value)),
        source: row.source === null ? null : String(row.source),
        matches: Number(row.matches),
        averageScore: Number(row.averageScore ?? 0),
        bestScore: Number(row.bestScore ?? 0),
        strong: Number(row.strong),
      }));
  };

  const [platforms, channels, kinds, intents] = await Promise.all([
    groupedBy(posts.source, false),
    // A channel is only meaningful beside its platform: "SaaS" on Reddit and a
    // TikTok hashtag of the same name are not one row.
    groupedBy(posts.channel, true),
    groupedBy(posts.kind, false),
    groupedBy(matches.intentType, false, (value) =>
      intentTypes.includes(value as IntentType) ? intentTypeLabel(value as IntentType) : value,
    ),
  ]);

  return { floor, platforms, channels, kinds, intents };
}
