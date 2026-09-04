/**
 * The poll step: ask every source a monitor names for what is new, and store
 * what comes back.
 *
 * This is the first code in the repository that calls a real connector. Read
 * docs/sources.md before changing it.
 *
 * Correctness-critical: cursor and deduplication. A source that answers with
 * `next.status === "wait"` has usually already started work that was billed —
 * a Bright Data collection is paid for when it is triggered, not when it is
 * read. Dropping that cursor buys records nobody reads and makes the next poll
 * buy them again. `continuations.ts` holds the row that stops it, and BUG-001
 * is what happens without it.
 *
 * Two limits here are deliberate, and neither is a performance setting.
 * `maxPagesPerPoll` bounds what one poll can spend, because the budget guard
 * does not exist yet (US-013) and an unbounded page loop against a metered
 * source is an invoice. `excerptLength` bounds what we keep, because Reddit's
 * terms require that content the author removed stops being shown, and the
 * less we hold, the less there is to remove.
 */
import { eq, sql } from "drizzle-orm";
import { maxResumeAttempts, monitors, posts, type Source } from "../db/schema.js";
import { monitorQueries } from "../monitors/monitors.js";
import type { SourceRegistry } from "../sources/registry.js";
import type {
  CandidatePost,
  SocialSource,
  SourceCredentials,
  SourceQuery,
} from "../sources/types.js";
import {
  type Continuation,
  continuationsFor,
  forgetContinuation,
  rememberContinuation,
} from "./continuations.js";
import type { CredentialLookup } from "./credentials.js";
import { filterQueue, type PollPayload, pollQueue } from "./queues.js";
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
  /**
   * The cursor to come back with. Absent means the source withdrew it: the
   * query is started again from the beginning rather than resumed.
   */
  readonly waitCursor?: string;
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
  startCursor?: string,
): Promise<SourceOutcome> {
  const collected: CandidatePost[] = [];
  let unitsConsumed = 0;
  let cursor = startCursor;
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
      // window, expires the job. The cursor travels back to the caller, which
      // writes it down before this job ends.
      return {
        sourceId: source.id,
        pages,
        posts: collected,
        unitsConsumed,
        waitUntil: result.next.retryAfter,
        ...(result.next.cursor === undefined ? {} : { waitCursor: result.next.cursor }),
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

    const queries = monitorQueries(monitor.generatedQueries);
    const channels = monitor.generatedSubreddits;

    /**
     * Collections this monitor already has in flight, by source.
     *
     * Read before anything is asked of a source. A source named here has been
     * paid for already — Bright Data bills a collection when it is triggered —
     * so starting its query again is the second charge BUG-001 was recorded
     * for.
     */
    const pending = new Map(
      (await continuationsFor(db, monitorId)).map((continuation) => [
        continuation.source as string,
        continuation,
      ]),
    );

    const now = new Date();
    const outcomes: SourceOutcome[] = [];

    /** The earliest moment any source asked to be tried again. */
    let wakeAt: Date | undefined;
    const wakeNoLaterThan = (moment: Date) => {
      if (!wakeAt || moment < wakeAt) wakeAt = moment;
    };

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

      const continuation: Continuation | undefined = pending.get(sourceId);

      if (continuation && continuation.attempts >= maxResumeAttempts) {
        // The collection never became ready. Forgetting it lets the next
        // scheduled poll ask the question again; keeping it would leave the
        // monitor waiting on a snapshot for ever. Nothing is triggered in its
        // place here, because giving up must not itself spend money.
        logger.error(
          { monitorId, sourceId, attempts: continuation.attempts },
          "collection abandoned: it was never ready to read",
        );
        await forgetContinuation(db, monitorId, continuation.source);
        continue;
      }

      if (continuation && continuation.resumeAfter > now) {
        // The source said when to come back, and it is not yet time. This is
        // the branch a scheduler tick lands in, and reaching the source from
        // here is what triggered a second collection before BUG-001 was fixed.
        logger.debug(
          { monitorId, sourceId, resumeAfter: continuation.resumeAfter },
          "source skipped: its collection is still running",
        );
        wakeNoLaterThan(continuation.resumeAfter);
        continue;
      }

      /**
       * A resume asks the question its collection was started with.
       *
       * `monitors.last_polled_at` moved when the collection was triggered, so
       * reading it here would ask for posts newer than the trigger, and every
       * record the collection was paid for would be filtered away as old.
       */
      const window = continuation ? continuation.since : since;

      const outcome = await readSource(
        source,
        { queries, channels, ...(window ? { since: window } : {}) },
        credentials,
        continuation?.cursor,
      );
      outcomes.push(outcome);

      logger.info(
        {
          monitorId,
          sourceId,
          resumed: continuation !== undefined,
          pages: outcome.pages,
          posts: outcome.posts.length,
          unitsConsumed: outcome.unitsConsumed,
          waitUntil: outcome.waitUntil,
        },
        "source read",
      );

      if (outcome.waitUntil) {
        wakeNoLaterThan(outcome.waitUntil);

        if (outcome.waitCursor) {
          await rememberContinuation(db, monitorId, {
            source: source.id as Source,
            cursor: outcome.waitCursor,
            ...(window ? { since: window } : {}),
            resumeAfter: outcome.waitUntil,
          });
        } else if (continuation) {
          // A wait with no cursor is the interface saying "start this query
          // again from the beginning". The old cursor names a snapshot the
          // source no longer wants us to read.
          await forgetContinuation(db, monitorId, continuation.source);
        }
      } else if (continuation) {
        // Read to the end. Nothing left to come back for.
        await forgetContinuation(db, monitorId, continuation.source);
      }
    }

    /**
     * One alarm clock for the monitor, set to the earliest thing it is waiting
     * on.
     *
     * The rows written above are the durable fact; this job only wakes someone
     * to read them. So a refusal here is not a lost collection: the queue
     * policy refuses precisely when a poll for this monitor is already queued,
     * and that poll will find the same rows. It is also why the alarm is set
     * again for a continuation that was skipped rather than written — a job
     * lost to a dead letter queue must not strand a snapshot until the
     * monitor's own interval comes round.
     */
    if (wakeAt) {
      const jobId = await boss.send(
        pollQueue,
        { monitorId },
        { singletonKey: monitorId, startAfter: wakeAt },
      );

      if (jobId === null) {
        logger.debug({ monitorId, wakeAt }, "resume not booked: a poll is already queued");
      }
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
