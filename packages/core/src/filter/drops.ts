/**
 * What the pre-filter kept from the model, written down.
 *
 * The rows exist for one question: **is the threshold dropping good leads?**
 * Nobody can answer that from an inbox, because a post that was dropped leaves
 * no trace in one. So every drop is stored with the stage that made it and,
 * where there is one, the similarity that decided it.
 *
 * The counts below are the same rows added up, and the monitor list shows
 * them. A person who sees "the embedding stage dropped 340 of 400 posts" has a
 * reason to look; one who sees a quiet inbox has nothing to look at.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { type FilterStage, filterDrops } from "../db/schema.js";

export interface FilterDrop {
  readonly postId: string;
  readonly stage: FilterStage;
  /** Cosine similarity. Null at the keyword stage: nothing was embedded. */
  readonly similarity?: number | null;
}

/**
 * Record what this poll dropped for this monitor.
 *
 * A post the last poll already dropped is updated rather than added again. The
 * count on the screen is a count of posts, not of polls, and a source that
 * returns the same post every hour would otherwise turn one drop into a
 * hundred.
 */
export async function recordFilterDrops(
  db: Database,
  monitorId: string,
  drops: readonly FilterDrop[],
): Promise<void> {
  if (drops.length === 0) return;

  await db
    .insert(filterDrops)
    .values(
      drops.map((drop) => ({
        monitorId,
        postId: drop.postId,
        stage: drop.stage,
        similarity: drop.similarity ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [filterDrops.monitorId, filterDrops.postId],
      set: {
        stage: sql`excluded.stage`,
        similarity: sql`excluded.similarity`,
        createdAt: sql`now()`,
      },
    });
}

/** How many posts each stage has dropped, for one monitor. */
export interface FilterDropCounts {
  readonly keyword: number;
  readonly embedding: number;
}

export const noFilterDrops: FilterDropCounts = { keyword: 0, embedding: 0 };

/**
 * Every named monitor's counts, or every monitor's, in one read.
 *
 * A monitor that has dropped nothing is absent from the map rather than
 * present with zeros. Zero here is not ambiguous — it means this monitor's
 * filter has dropped no post — so a caller may default to `noFilterDrops`
 * without hiding anything. That is not true of spend, which is why
 * `spendByMonitor` fills its zeros in and this does not.
 */
export async function filterDropCounts(
  db: Database,
  monitorIds?: readonly string[],
): Promise<Map<string, FilterDropCounts>> {
  const rows = await db
    .select({
      monitorId: filterDrops.monitorId,
      stage: filterDrops.stage,
      dropped: count(),
    })
    .from(filterDrops)
    .where(
      monitorIds && monitorIds.length > 0
        ? inArray(filterDrops.monitorId, [...monitorIds])
        : undefined,
    )
    .groupBy(filterDrops.monitorId, filterDrops.stage);

  const counts = new Map<string, { keyword: number; embedding: number }>();

  for (const row of rows) {
    const entry = counts.get(row.monitorId) ?? { keyword: 0, embedding: 0 };
    entry[row.stage] = Number(row.dropped);
    counts.set(row.monitorId, entry);
  }

  return counts;
}

/**
 * The drops one monitor's embedding stage made, newest first.
 *
 * This is the review instrument the ticket asks for: the similarity of every
 * post the threshold refused, so the number can be moved against real data
 * rather than intuition. Nothing calls it from a screen yet; it is the query a
 * person runs when they suspect the threshold is too high.
 */
export async function embeddingDropSimilarities(
  db: Database,
  monitorId: string,
  limit = 200,
): Promise<number[]> {
  const rows = await db
    .select({ similarity: filterDrops.similarity })
    .from(filterDrops)
    .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.stage, "embedding")))
    .orderBy(sql`${filterDrops.createdAt} desc`)
    .limit(limit);

  return rows
    .map((row) => row.similarity)
    .filter((similarity): similarity is number => similarity !== null);
}
