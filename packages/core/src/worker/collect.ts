/**
 * The poll step: ask every source a monitor names for what is new, and store
 * what comes back.
 *
 * This is the first code in the repository that calls a real connector. Read
 * docs/sources.md before changing it.
 *
 * Two limits here are deliberate, and neither is a performance setting.
 * `maxPagesPerPoll` bounds what one poll can spend, because the budget guard
 * does not exist yet (US-013) and an unbounded page loop against a metered
 * source is an invoice. `excerptLength` bounds what we keep, because Reddit's
 * terms require that content the author removed stops being shown, and the
 * less we hold, the less there is to remove.
 */
import { eq, sql } from "drizzle-orm";
import { monitors, posts, type Source } from "../db/schema.js";
import { monitorQueries } from "../monitors/monitors.js";
import type { SourceRegistry } from "../sources/registry.js";
import type {
  CandidatePost,
  SocialSource,
  SourceCredentials,
  SourceQuery,
} from "../sources/types.js";
import type { CredentialLookup } from "./credentials.js";
import { filterQueue, type PollPayload } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

/**
 * How many pages one poll may fetch from one source.
 *
 * Five pages is a generous hour of conversation and a bill that one mistake
 * cannot make unbounded. When US-013 lands, the cap it enforces is the real
 * limit and this becomes the backstop behind it.
 */
export const maxPagesPerPoll = 5;

/** Characters of post text kept. The rest is read at the source, by a person. */
export const excerptLength = 2000;

export interface CollectOptions {
  readonly registry: SourceRegistry;
  readonly credentialsFor: CredentialLookup;
}

/** What one source returned in one poll. US-013 records the units against a budget. */
interface SourceOutcome {
  readonly sourceId: string;
  readonly pages: number;
  readonly posts: readonly CandidatePost[];
  readonly unitsConsumed: number;
  /** Set when the source asked us to come back later rather than serving more. */
  readonly waitUntil?: Date;
}

/**
 * Page through one source until it is done, until it asks us to wait, or until
 * the page cap stops us.
 *
 * The stopping rule reads `next`, never `posts.length`. A source may return a
 * short page and still have more behind it, and a caller that stops on a short
 * page silently loses everything after the first one.
 */
async function readSource(
  source: SocialSource,
  query: SourceQuery,
  credentials: SourceCredentials,
): Promise<SourceOutcome> {
  const collected: CandidatePost[] = [];
  let unitsConsumed = 0;
  let cursor: string | undefined;
  let pages = 0;

  while (pages < maxPagesPerPoll) {
    const result = await source.search({ query, credentials, cursor });

    pages += 1;
    unitsConsumed += result.unitsConsumed;
    collected.push(...result.posts);

    if (result.next.status === "done") break;

    if (result.next.status === "wait") {
      // The connector already backed off as far as it was willing to. Holding
      // the job open for the remainder blocks a worker slot and, on a long
      // window, expires the job. The next poll starts the query again.
      return {
        sourceId: source.id,
        pages,
        posts: collected,
        unitsConsumed,
        waitUntil: result.next.retryAfter,
      };
    }

    cursor = result.next.cursor;
  }

  return { sourceId: source.id, pages, posts: collected, unitsConsumed };
}

function toRow(sourceId: Source, post: CandidatePost) {
  return {
    source: sourceId,
    externalId: post.externalId,
    url: post.url,
    author: post.author ?? null,
    channel: post.channel ?? null,
    title: post.title ?? null,
    excerpt: post.text.slice(0, excerptLength),
    postedAt: post.postedAt,
  };
}

export function createCollectStep({ registry, credentialsFor }: CollectOptions): Step<PollPayload> {
  return async function collect({ monitorId }, { db, boss, logger }: StepContext): Promise<void> {
    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);

    if (!monitor) {
      // The monitor was deleted between the tick and the job. Not a failure:
      // retrying would never find it, and dead-lettering it says nothing.
      logger.warn({ monitorId }, "poll skipped: the monitor is gone");
      return;
    }

    // Read before writing. `since` is where the last poll got to, and the next
    // statement is what moves that mark forward.
    const since = monitor.lastPolledAt ?? undefined;

    // Marked at the start, not at the end: the interval measures poll starts,
    // so a poll that runs long does not stretch the interval it was given.
    await db.update(monitors).set({ lastPolledAt: sql`now()` }).where(eq(monitors.id, monitorId));

    const query: SourceQuery = {
      queries: monitorQueries(monitor.generatedQueries),
      channels: monitor.generatedSubreddits,
      since,
    };

    const outcomes: SourceOutcome[] = [];

    for (const sourceId of monitor.sources) {
      const source = registry.get(sourceId);
      const credentials = credentialsFor(source);

      if (!credentials) {
        // A missing key is not transient. Retrying it four times and then
        // dead-lettering it buries the one sentence the user has to read.
        logger.error(
          { monitorId, sourceId, needs: source.credentialFields.map((field) => field.name) },
          "poll skipped for this source: no credentials are configured",
        );
        continue;
      }

      const outcome = await readSource(source, query, credentials);
      outcomes.push(outcome);

      logger.info(
        {
          monitorId,
          sourceId,
          pages: outcome.pages,
          posts: outcome.posts.length,
          unitsConsumed: outcome.unitsConsumed,
          waitUntil: outcome.waitUntil,
        },
        "source read",
      );
    }

    const rows = outcomes.flatMap((outcome) =>
      outcome.posts.map((post) => toRow(outcome.sourceId as Source, post)),
    );

    if (rows.length === 0) return;

    /**
     * Every post this poll saw, not only the new ones.
     *
     * A post stored by one monitor's poll has still never been matched against
     * a second monitor, so returning only the inserted rows would drop it out
     * of that monitor's pipeline for good. `do update` on `fetched_at` alone
     * returns every id and rewrites nothing else: refreshing the excerpt here
     * would let a poll resurrect text the author had already removed, which is
     * the failure US-015 exists to prevent.
     */
    const stored = await db
      .insert(posts)
      .values(rows)
      .onConflictDoUpdate({
        target: [posts.source, posts.externalId],
        set: { fetchedAt: sql`now()` },
      })
      .returning({ id: posts.id });

    await boss.send(filterQueue, { monitorId, postIds: stored.map((row) => row.id) });
  };
}
