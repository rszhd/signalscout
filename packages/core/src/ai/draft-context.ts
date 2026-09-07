/**
 * Everything a draft needs about one match, in one read.
 *
 * US-040. It lives in core rather than in the API for the reason every query
 * does: `apps/api` imports no `drizzle-orm`, and `packages/core` is where the
 * database is reached. The route reads this and turns it into a prompt.
 *
 * Three tables: the match to find the pair, the post to answer, and the
 * monitor for the four answers the prompt is built on. The voice is not among
 * them — a saved instruction belongs to the account and is chosen at the
 * moment of drafting, so the route reads it by id rather than joining to it.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { Signal } from "../db/schema.js";
import { matches, monitors, posts } from "../db/schema.js";

/** One match, with everything needed to write a reply to it. */
export interface DraftContext {
  readonly matchId: string;
  readonly monitorId: string;
  readonly monitorVersion: number;
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
  readonly signals: readonly Signal[];
  readonly postId: string;
  readonly source: string;
  readonly channel: string | null;
  readonly author: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  readonly postedAt: Date;
}

/** Read one match, or nothing when no match has that id. */
export async function draftContext(
  db: Database,
  matchId: string,
): Promise<DraftContext | undefined> {
  const [row] = await db
    .select({
      matchId: matches.id,
      monitorId: monitors.id,
      monitorVersion: monitors.version,
      product: monitors.product,
      idealCustomer: monitors.idealCustomer,
      problem: monitors.problem,
      signals: monitors.signals,
      postId: posts.id,
      source: posts.source,
      channel: posts.channel,
      author: posts.author,
      title: posts.title,
      excerpt: posts.excerpt,
      postedAt: posts.postedAt,
    })
    .from(matches)
    .innerJoin(monitors, eq(matches.monitorId, monitors.id))
    .innerJoin(posts, eq(matches.postId, posts.id))
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!row) return undefined;

  return {
    ...row,
    signals: row.signals as readonly Signal[],
    excerpt: row.excerpt ?? "",
  };
}
