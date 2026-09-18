/**
 * Which of a monitor's inputs earn their keep. US-212.
 *
 * A monitor searches several phrases across several channels, and until
 * `post_discoveries` existed nothing could say which of them produced
 * anything. A phrase that has never matched is searched on every poll, on
 * every channel, for ever.
 *
 * Three numbers decide whether a phrase stays, and they are read together
 * rather than separately because each is misleading alone. Posts found says
 * the phrase works as a search. Matches says it works as a *question* — a
 * phrase that finds two hundred posts and no leads is the expensive kind of
 * wrong. And the best score says whether the matches were worth reading, since
 * a dozen at 51 is not the same as one at 96.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type DiscoveryKind, matches, monitors, postDiscoveries } from "../db/schema.js";

export interface QueryPerformance {
  /** A phrase the monitor searches, or a channel it browses. */
  readonly kind: DiscoveryKind;
  readonly value: string;
  /** Posts this input has returned, however they were judged. */
  readonly posts: number;
  /** Of those, the ones that cleared this monitor's threshold. */
  readonly matches: number;
  /** The best score any of them reached, or null where none matched. */
  readonly bestScore: number | null;
  /** When it last found a post, which is how a dead phrase shows itself. */
  readonly lastFoundAt: Date | null;
}

/**
 * One monitor's inputs, best first, for one account.
 *
 * The owner is an argument rather than something this reads from the monitor,
 * which is BUG-009's lesson stated in a signature: a caller cannot forget to
 * scope a read it cannot perform unscoped.
 *
 * A post is counted for every input that found it. Two phrases that both
 * returned one post each get one post, and the poll paid for both searches —
 * so dividing it between them would understate what each one costs.
 */
export async function queryPerformance(
  db: Database,
  userId: string,
  monitorId: string,
): Promise<QueryPerformance[]> {
  const [owned] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1);

  if (!owned) return [];

  const rows = await db
    .select({
      kind: postDiscoveries.kind,
      value: postDiscoveries.value,
      posts: sql<number>`count(*)::int`,
      matches: sql<number>`count(${matches.id})::int`,
      bestScore: sql<number | null>`max(${matches.score})`,
      lastFoundAt: sql<Date | null>`max(${postDiscoveries.firstSeenAt})`,
    })
    .from(postDiscoveries)
    /**
     * The match of *this* monitor, not of any monitor that found the post.
     * `matches` is keyed by monitor and post, and a post two monitors hold is
     * one row here and two there.
     */
    .leftJoin(
      matches,
      and(eq(matches.postId, postDiscoveries.postId), eq(matches.monitorId, monitorId)),
    )
    .where(eq(postDiscoveries.monitorId, monitorId))
    .groupBy(postDiscoveries.kind, postDiscoveries.value)
    .orderBy(desc(sql`count(${matches.id})`), desc(sql`count(*)`));

  return rows.map((row) => ({
    kind: row.kind,
    value: row.value,
    posts: Number(row.posts),
    matches: Number(row.matches),
    bestScore: row.bestScore === null ? null : Number(row.bestScore),
    lastFoundAt: row.lastFoundAt === null ? null : new Date(row.lastFoundAt),
  }));
}
