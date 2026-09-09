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
 * `maxPagesPerPoll` bounds what one poll can spend. `excerptLength` bounds
 * what we keep, because Reddit's terms require that content the author removed
 * stops being shown, and the less we hold, the less there is to remove.
 *
 * US-013's budget guard is the third limit and it sits above both. It runs
 * before this step reaches a source, and it counts money rather than pages.
 * The two caps are complementary and neither replaces the other: the guard
 * cannot know what the next poll will cost, so the page cap is what bounds how
 * far past the cap one poll can carry a monitor.
 */
import { eq, sql } from "drizzle-orm";
import { enforceBudget, recordSourceUsage } from "../budget/budget.js";
import { maxResumeAttempts, monitors, type Provider, posts, type Source } from "../db/schema.js";
import { monitorQueries } from "../monitors/monitors.js";
import { readProviderChoices } from "../sources/choices.js";
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
 * cannot make unbounded. US-013's monthly cap is the limit on what a monitor
 * may spend; this is the limit on how far one poll can carry it past that,
 * because a page's cost is only known once the page has been fetched.
 *
 * It bounds one job, not one query. A source stopped here keeps its cursor in
 * `source_continuations` and the next poll reads on from it: the pages behind
 * that cursor are collected and billed already, so dropping it would make the
 * next poll buy the whole query again.
 */
export const maxPagesPerPoll = 5;

/** Characters of post text kept. The rest is read at the source, by a person. */
export const excerptLength = 2000;

export interface CollectOptions {
  readonly registry: SourceRegistry;
  readonly credentialsFor: CredentialLookup;
}

/** What one connector returned in one poll. US-013 records the units against a budget. */
interface SourceOutcome {
  readonly sourceId: string;
  readonly providerId: string;
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
  /**
   * Set when the page cap stopped a source that had another page ready now.
   *
   * It is kept for the same reason as `waitCursor`. The pages behind it are
   * collected and paid for already, so a poll that dropped this would make the
   * next one buy them a second time.
   */
  readonly moreCursor?: string;
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
  startCursor: string | undefined,
  /**
   * Write one page's units to the ledger, called as each page comes back
   * rather than once at the end.
   *
   * A poll that throws on its third page was billed for the first two. A
   * ledger that only heard about a whole poll would lose them, and the budget
   * guard would let the next poll spend that money a second time inside the
   * same cap.
   */
  bill: (units: number) => Promise<void>,
): Promise<SourceOutcome> {
  const collected: CandidatePost[] = [];
  let unitsConsumed = 0;
  let cursor = startCursor;
  let pages = 0;
  /** Where the next page starts, while there is one. Cleared when the source is done. */
  let more: string | undefined;

  while (pages < maxPagesPerPoll) {
    const result = await source.search({ query, credentials, cursor });

    pages += 1;
    unitsConsumed += result.unitsConsumed;
    collected.push(...result.posts);
    await bill(result.unitsConsumed);

    if (result.next.status === "done") {
      more = undefined;
      break;
    }

    if (result.next.status === "wait") {
      // The connector already backed off as far as it was willing to. Holding
      // the job open for the remainder blocks a worker slot and, on a long
      // window, expires the job. The cursor travels back to the caller, which
      // writes it down before this job ends.
      return {
        sourceId: source.platform.id,
        providerId: source.provider.id,
        pages,
        posts: collected,
        unitsConsumed,
        waitUntil: result.next.retryAfter,
        ...(result.next.cursor === undefined ? {} : { waitCursor: result.next.cursor }),
      };
    }

    cursor = result.next.cursor;
    more = result.next.cursor;
  }

  return {
    sourceId: source.platform.id,
    providerId: source.provider.id,
    pages,
    posts: collected,
    unitsConsumed,
    ...(more === undefined ? {} : { moreCursor: more }),
  };
}

function toRow(sourceId: Source, providerId: Provider, post: CandidatePost) {
  return {
    source: sourceId,
    // Attribution only. `UNIQUE (source, external_id)` does not read it, so a
    // post already stored keeps whichever provider first brought it back.
    provider: providerId,
    externalId: post.externalId,
    url: post.url,
    author: post.author ?? null,
    channel: post.channel ?? null,
    title: post.title ?? null,
    excerpt: post.text.slice(0, excerptLength),
    postedAt: post.postedAt,
    /**
     * How many replies the platform says this post has. US-020.
     *
     * Null where the platform did not say, which is not zero. The re-open rule
     * reads it, so a connector that omits it makes every thread look unchanged
     * — see the `coalesce` below, which is the other half of the same rule.
     */
    replyCount: post.replyCount ?? null,
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

    /**
     * The budget guard, before anything is asked of a source.
     *
     * Correctness-critical: this is the check the whole of US-013 exists for,
     * and it has to run here rather than after the call, because a page is
     * billed when it is fetched. `enforceBudget` also applies what the monitor
     * asked for — `pause` writes `paused_at`, so the scheduler stops queueing
     * polls at all; `notify` leaves it running and each poll is refused here
     * in turn, so the monitor starts again by itself next month.
     *
     * The poll is refused whole, including a collection this monitor has
     * already paid for and not yet read. That snapshot is a loss the guard
     * cannot recover: reading it would spend no more at the source but would
     * send every post it holds to the classifier, which is money past the cap.
     * The continuation row stays, so raising the cap reads it rather than
     * paying for the query again. US-014 is the ticket that stops a query
     * whose cost the person never saw.
     *
     * Logged as an error, not a warning. A monitor that has stopped collecting
     * is the one thing about this product a person must not learn from an
     * empty inbox. It is also on the monitor list, from the same sentence.
     */
    const budget = await enforceBudget(db, monitorId);

    if (budget.exhausted) {
      logger.error(
        {
          monitorId,
          spentMicros: budget.spend.totalMicros,
          capMicros: budget.capMicros,
          onExhausted: budget.onExhausted,
        },
        budget.reason ?? "poll refused: this monitor has spent its monthly budget",
      );
      return;
    }

    // Read before writing. `since` is where the last poll got to, and the next
    // statement is what moves that mark forward.
    const since = monitor.lastPolledAt ?? undefined;

    // Marked at the start, not at the end: the interval measures poll starts,
    // so a poll that runs long does not stretch the interval it was given.
    await db.update(monitors).set({ lastPolledAt: sql`now()` }).where(eq(monitors.id, monitorId));

    const channels = monitor.generatedSubreddits;

    /**
     * Collections this monitor already has in flight, by platform.
     *
     * Read before anything is asked of a source. A source named here has been
     * paid for already — Bright Data bills a collection when it is triggered —
     * so starting its query again is the second charge BUG-001 was recorded
     * for.
     *
     * Keyed by platform and not by the pair, because a continuation is what
     * decides the provider for this poll. A monitor has at most one collection
     * per platform in flight: a poll resumes one before it starts another, so
     * a second one is never triggered while the first is unread.
     */
    const pending = new Map(
      (await continuationsFor(db, monitorId)).map((continuation) => [
        continuation.source as string,
        continuation,
      ]),
    );

    /**
     * Which provider fetches each platform, read here rather than at boot.
     *
     * Per poll, so a choice made on the connections screen takes effect on the
     * next collection and needs no restart. It is one small select, and this
     * job is about to make network calls that cost money.
     */
    const choices = await readProviderChoices(db);

    const now = new Date();
    const outcomes: SourceOutcome[] = [];

    /** The earliest moment any source asked to be tried again. */
    let wakeAt: Date | undefined;
    const wakeNoLaterThan = (moment: Date) => {
      if (!wakeAt || moment < wakeAt) wakeAt = moment;
    };

    for (const sourceId of monitor.sources) {
      /**
       * A platform this build no longer offers is skipped, not failed.
       *
       * US-053. A monitor written before the switch still names it, and the
       * rest of its platforms are collected exactly as before: a decision
       * somebody made about a connector is not an error in this job. The reason
       * is logged because a short poll otherwise reads as a quiet platform.
       */
      const notOffered = registry.notOffered(sourceId);

      if (notOffered) {
        logger.info(
          { monitorId, sourceId, reason: notOffered },
          "poll skipped for this source: this build does not offer a connector for it",
        );
        continue;
      }

      /**
       * Which of this platform's providers could run, and with what key.
       *
       * A monitor names a platform and its row records no provider, so the
       * provider is decided here. Every candidate is asked for its key first,
       * because "one provider connected" is the common deployment and it must
       * not be asked a question it has one answer to. Reddit has two
       * connectors in the build and most instances hold one of the two keys.
       */
      const keyed = new Map<string, SourceCredentials>();

      for (const candidate of registry.forPlatform(sourceId)) {
        const found = await credentialsFor(candidate, monitor.userId);
        if (found) keyed.set(candidate.provider.id, found);
      }

      if (keyed.size === 0) {
        // A missing key is not transient. Retrying it four times and then
        // dead-lettering it buries the one sentence the user has to read.
        logger.error(
          {
            monitorId,
            sourceId,
            providers: registry.forPlatform(sourceId).map((candidate) => candidate.provider.id),
          },
          "poll skipped for this source: no provider for it has credentials configured",
        );
        continue;
      }

      /**
       * A collection in flight belongs to the provider that started it.
       *
       * Correctness-critical, and US-026 is the ticket that made it possible
       * to get wrong. The cursor is opaque and means nothing to another
       * provider, so resuming a Bright Data snapshot through ScrapeCreators
       * reads a snapshot id ScrapeCreators has never heard of — and on a
       * provider that bills at collection time it also pays for the work
       * twice. So a changed choice takes effect on the *next* collection, and
       * the one already running finishes where it started.
       */
      const continuation: Continuation | undefined = pending.get(sourceId);

      let source: SocialSource;

      if (continuation) {
        if (!keyed.has(continuation.provider)) {
          // The key that started this collection is gone. Nothing else can
          // read it, and the row stays so that putting the key back reads the
          // snapshot rather than paying for the query again.
          logger.error(
            { monitorId, sourceId, providerId: continuation.provider },
            "collection cannot be resumed: the provider that started it has no credentials",
          );
          continue;
        }

        source = registry.get(sourceId, continuation.provider);
      } else {
        try {
          source = registry.only(sourceId, { choices, among: [...keyed.keys()] });
        } catch (error) {
          // Two providers can run and nobody has chosen, or the choice names
          // one that cannot. Neither is fixed by retrying, and neither is
          // fixed by picking for them: the point of the refusal is that
          // spending somebody's money is not a default. The message names the
          // repair.
          logger.error(
            { monitorId, sourceId, err: error },
            "poll skipped for this source: no provider is chosen for it",
          );
          continue;
        }
      }

      const providerId = source.provider.id;
      // Present by construction: every branch above chose from this map.
      const credentials = keyed.get(providerId) as SourceCredentials;

      if (continuation && continuation.attempts >= maxResumeAttempts) {
        // The collection never became ready. Forgetting it lets the next
        // scheduled poll ask the question again; keeping it would leave the
        // monitor waiting on a snapshot for ever. Nothing is triggered in its
        // place here, because giving up must not itself spend money.
        logger.error(
          { monitorId, sourceId, providerId, attempts: continuation.attempts },
          "collection abandoned: it was never ready to read",
        );
        await forgetContinuation(db, monitorId, continuation.source, continuation.provider);
        continue;
      }

      if (continuation && continuation.resumeAfter > now) {
        // The source said when to come back, and it is not yet time. This is
        // the branch a scheduler tick lands in, and reaching the source from
        // here is what triggered a second collection before BUG-001 was fixed.
        logger.debug(
          { monitorId, sourceId, providerId, resumeAfter: continuation.resumeAfter },
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

      /**
       * This platform's own queries, and never another platform's.
       *
       * US-027. A phrase written for Reddit returns nothing on X, and a
       * phrase written for X is too short to be worth a Reddit collection.
       * Read inside the loop for that reason: one monitor holds a list per
       * platform, and the platform being polled decides which list it is.
       */
      const queries = monitorQueries(monitor.generatedQueries, sourceId);

      const outcome = await readSource(
        source,
        { queries, channels, ...(window ? { since: window } : {}) },
        credentials,
        continuation?.cursor,
        (units) =>
          recordSourceUsage(db, {
            userId: monitor.userId,
            monitorId,
            // The registry's id space is wider than the schema's, and this
            // narrowing is safe for the same reason `toRow`'s is: a monitor
            // can only name a source the `monitors.sources` column accepts,
            // and a registered provider is one `api_usage` accepts.
            source: source.platform.id as Source,
            provider: providerId as Provider,
            units,
            // The connector's price, which is the pair's and not the
            // platform's. Two providers fetching one platform do not agree
            // about it, and this is the multiplication that would be wrong.
            pricePerUnitMicros: source.pricePerUnitMicros,
          }),
      );
      outcomes.push(outcome);

      logger.info(
        {
          monitorId,
          sourceId,
          providerId,
          resumed: continuation !== undefined,
          pages: outcome.pages,
          posts: outcome.posts.length,
          unitsConsumed: outcome.unitsConsumed,
          waitUntil: outcome.waitUntil,
        },
        "source read",
      );

      const progressed = outcome.posts.length > 0;

      if (outcome.waitUntil) {
        wakeNoLaterThan(outcome.waitUntil);

        if (outcome.waitCursor) {
          await rememberContinuation(db, monitorId, {
            source: source.platform.id as Source,
            provider: providerId as Provider,
            cursor: outcome.waitCursor,
            ...(window ? { since: window } : {}),
            resumeAfter: outcome.waitUntil,
            progressed,
          });
        } else if (continuation) {
          // A wait with no cursor is the interface saying "start this query
          // again from the beginning". The old cursor names a snapshot the
          // source no longer wants us to read.
          await forgetContinuation(db, monitorId, continuation.source, continuation.provider);
        }
      } else if (outcome.moreCursor) {
        /**
         * The page cap stopped a source that had another page ready.
         *
         * It is remembered like a wait, and due at once, because the pages
         * behind the cursor are already collected and already billed: reading
         * them costs nothing and dropping the cursor makes the next poll
         * collect the whole query again. The cap still holds — it is what one
         * job may fetch, and US-013's budget guard is what a monitor may
         * spend.
         */
        await rememberContinuation(db, monitorId, {
          source: source.platform.id as Source,
          provider: providerId as Provider,
          cursor: outcome.moreCursor,
          ...(window ? { since: window } : {}),
          resumeAfter: now,
          progressed,
        });
        wakeNoLaterThan(now);
      } else if (continuation) {
        // Read to the end. Nothing left to come back for.
        await forgetContinuation(db, monitorId, continuation.source, continuation.provider);
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
      outcome.posts.map((post) =>
        toRow(outcome.sourceId as Source, outcome.providerId as Provider, post),
      ),
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
        set: {
          fetchedAt: sql`now()`,
          /**
           * The reply count is refreshed where the text is not, and the
           * difference is the point. US-020's re-open rule buys a thread again
           * only when this number has grown, so a column frozen at its first
           * value makes the rule inert: a conversation that gained twenty
           * replies looks exactly like one that gained none.
           *
           * Refreshing it is safe for the reason the excerpt is not. This is a
           * counter, not content, so a later poll cannot resurrect words an
           * author removed by writing it — which is the failure US-015 exists
           * to prevent and the reason every other field here stays put.
           *
           * `coalesce` keeps what we know when a later fetch does not say. A
           * connector that omits the count must not erase a number an earlier
           * one gave us.
           */
          replyCount: sql`coalesce(excluded.reply_count, ${posts.replyCount})`,
        },
      })
      .returning({ id: posts.id });

    await boss.send(filterQueue, { monitorId, postIds: stored.map((row) => row.id) });
  };
}
