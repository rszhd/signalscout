/**
 * How many posts one pair may put to the classifier in a day. US-287.
 *
 * Correctness-critical: the bound an application's allowance rests on. The
 * hosted product sizes its plans on 25 new posts a pair a day at $0.00025 a
 * post; a daily poll kept that number by accident through `maxPagesPerPoll`,
 * and hourly polling does not. `ceiling.test.ts` holds the assertions, and
 * they were written first.
 *
 * **A pair is one query on one platform**, as `post_discoveries` (US-212)
 * records it: `(source, kind, value)` for one monitor. A channel a monitor
 * browses is a pair of its own. A reply belongs to the pairs that found its
 * parent, because nothing searched for the reply.
 *
 * **The count is the ledger's.** "How many posts this pair put to the
 * classifier today" is `model_calls` with purpose `classification` since the
 * UTC day began, joined to the discoveries over `(monitor_id, post_id)` —
 * through the parent for a reply. A counter of our own would be a second fact
 * that can disagree with the ledger, and the ledger already knows every
 * classification and which post it was.
 *
 * **A post is admitted while any pair that found it has room**, and it counts
 * against every pair that found it: both searches earned it, and a poll that
 * deduplicated it into one row still paid for both. A post no pair can be
 * found for — a row older than US-212 — is admitted, because the ceiling
 * cannot say whose day it would spend.
 *
 * **Off unless an application sets it.** The self-hosted product runs on its
 * owner's keys and reads every post it finds. `startWorker` passes the number
 * the way it passes the entitlement gate (US-153); unset, nothing here runs.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { modelCalls, postDiscoveries, posts } from "../db/schema.js";

/** The start of the UTC day this moment is in. */
export function startOfUtcDay(moment: Date): Date {
  return new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate()));
}

/** One pair, as a key: the discovery's source, kind and value. */
function pairKey(source: string, kind: string, value: string): string {
  return `${source}\u0000${kind}\u0000${value}`;
}

/**
 * The day's room for one monitor's pairs, loaded once for a batch of posts
 * and then asked post by post. The in-memory tallies move as the batch is
 * admitted, so the fiftieth post of a busy pair is refused inside the same
 * job that admitted the first twenty-five.
 */
export class Ceiling {
  private readonly used: Map<string, number>;
  private readonly pairsOf: Map<string, readonly string[]>;
  private readonly limit: number;

  constructor(limit: number, used: Map<string, number>, pairsOf: Map<string, readonly string[]>) {
    this.limit = limit;
    this.used = used;
    this.pairsOf = pairsOf;
  }

  /** Whether any pair that found this post still has room today. */
  hasRoom(postId: string): boolean {
    const pairs = this.pairsOf.get(postId);
    if (!pairs || pairs.length === 0) return true;
    return pairs.some((pair) => (this.used.get(pair) ?? 0) < this.limit);
  }

  /** Spend this many of the day on every pair that found this post. */
  charge(postId: string, units = 1): void {
    for (const pair of this.pairsOf.get(postId) ?? []) {
      this.used.set(pair, (this.used.get(pair) ?? 0) + units);
    }
  }

  /** What one post's pairs have used today, for a log line. */
  usedBy(postId: string): number {
    return Math.max(0, ...(this.pairsOf.get(postId) ?? []).map((pair) => this.used.get(pair) ?? 0));
  }
}

/**
 * Load the day's tallies for these posts' pairs, from the ledger. Two reads,
 * however many posts: the pairs that found each post, and what each of those
 * pairs has put to the classifier since the UTC day began.
 */
export async function loadCeiling(
  db: Database,
  monitorId: string,
  postIds: readonly string[],
  limit: number,
  now: Date = new Date(),
): Promise<Ceiling> {
  const pairsOf = new Map<string, readonly string[]>();
  const used = new Map<string, number>();
  if (postIds.length === 0) return new Ceiling(limit, used, pairsOf);

  // A reply's pairs are its parent's: nothing searched for the reply.
  const found = sql`coalesce(${posts.parentPostId}, ${posts.id})`;

  const discovered = await db
    .select({
      postId: posts.id,
      source: postDiscoveries.source,
      kind: postDiscoveries.kind,
      value: postDiscoveries.value,
    })
    .from(posts)
    .innerJoin(
      postDiscoveries,
      and(eq(postDiscoveries.monitorId, monitorId), eq(postDiscoveries.postId, found)),
    )
    .where(inArray(posts.id, [...postIds]));

  for (const row of discovered) {
    const key = pairKey(row.source, row.kind, row.value);
    pairsOf.set(row.postId, [...(pairsOf.get(row.postId) ?? []), key]);
  }

  const pairs = new Set([...pairsOf.values()].flat());
  if (pairs.size === 0) return new Ceiling(limit, used, pairsOf);

  const today = await db
    .select({
      source: postDiscoveries.source,
      kind: postDiscoveries.kind,
      value: postDiscoveries.value,
      classified: sql<string>`count(distinct ${modelCalls.postId})`,
    })
    .from(modelCalls)
    .innerJoin(posts, eq(posts.id, modelCalls.postId))
    .innerJoin(
      postDiscoveries,
      and(eq(postDiscoveries.monitorId, modelCalls.monitorId), eq(postDiscoveries.postId, found)),
    )
    .where(
      and(
        eq(modelCalls.monitorId, monitorId),
        eq(modelCalls.purpose, "classification"),
        gte(modelCalls.createdAt, startOfUtcDay(now)),
      ),
    )
    .groupBy(postDiscoveries.source, postDiscoveries.kind, postDiscoveries.value);

  for (const row of today) {
    const key = pairKey(row.source, row.kind, row.value);
    if (pairs.has(key)) used.set(key, Number(row.classified));
  }

  return new Ceiling(limit, used, pairsOf);
}
