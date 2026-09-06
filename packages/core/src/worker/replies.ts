/**
 * Open the threads under the posts a monitor's pre-filter kept, and store what
 * was said in them.
 *
 * **Where the money goes, and why this step exists at all.** Fetching replies
 * is cheap and classifying them is not. One ScrapeCreators credit — $0.00188 —
 * buys a page of about 25 Reddit comments, but a subreddit poll of 23 posts
 * holds roughly 280 of them, and every one that survives triage buys a model
 * call. So the control that matters is not whether replies are fetched; it is
 * **which threads are opened, and how often**. This step is those two rules and
 * little else.
 *
 * 1. **Only under a post the pre-filter kept.** A thread under a post the
 *    filter already refused is a conversation nobody was going to read.
 * 2. **Only when something new was said.** Every connector reports the
 *    platform's own reply count on the post, so a thread whose count has not
 *    grown since the last pass is skipped without a call. Without this rule a
 *    monitor polling hourly re-buys every thread it has ever seen, for ever.
 *
 * **One page per thread, and then stop.** Measured on 2026-09-06: a credit buys
 * about 25 comments whatever the thread holds, and the page Reddit ranks first
 * is the page a reader would see first. Buying the rest costs a call per nested
 * subtree and lands the least-ranked half of the thread on the classifier's
 * bill. `sources/types.ts` says why `ReplyResult.partial` is not the same
 * question as `next.status`.
 *
 * **Replies go back through the filter, not straight to the classifier.** They
 * arrive as `kind = 'reply'` rows, and `filter.ts` skips the keyword and
 * embedding stages for them — US-029 measured that a comment borrows its
 * subject from the post above it, so both of those stages are either useless or
 * harmful there. Triage still runs, and on a reply it is the only paid stage in
 * front of the classifier.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { enforceBudget, recordSourceUsage } from "../budget/budget.js";
import { matches, monitors, type Provider, posts, type Source } from "../db/schema.js";
import { readProviderChoices } from "../sources/choices.js";
import type { CandidateReply, SocialSource, SourceCredentials } from "../sources/types.js";
import type { CollectOptions } from "./collect.js";
import { excerptLength } from "./collect.js";
import type { RepliesPayload } from "./queues.js";
import { filterQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

/**
 * The most threads one job will open.
 *
 * A bound rather than a setting, for the reason `maxPagesPerPoll` is one: the
 * budget guard runs before the work and cannot know what the work will cost, so
 * something has to stop one poll spending a month's cap. Twenty-five threads is
 * about 600 replies, which is already more than a person reads in a day.
 */
export const maxThreadsPerJob = 25;

/**
 * The most pages one thread may buy in one job.
 *
 * Found missing by reading US-034's live YouTube run rather than by the suite:
 * this step called `fetchReplies` once and never read `next`, so a video with
 * three thousand comments gave us the newest fifty-one and stopped. The window
 * above hides that in the quiet case and not in the busy one — a thread where
 * five hundred comments landed this week returned one page of them, silently.
 *
 * Four is a judgement and the shape of the guess is deliberate. A page is 25
 * comments at ScrapeCreators and 51 at SocialCrawl, so four pages is 100 to 200
 * replies from one thread, which is already more than a person reads. Against
 * the 90-day window most threads end well inside it, and the connectors say so:
 * `next.status === "done"` ends the walk before this number is reached.
 *
 * It bounds the damage rather than solving the problem. A thread busier than
 * this is read in part and recorded as partial, which is the honest answer and
 * the one `repliesPartial` exists to carry.
 */
export const maxPagesPerThread = 4;

/**
 * How many comments one batch buys before the threshold is consulted.
 *
 * Fifty, and the number is chosen with `maxEmptyBatches` rather than alone.
 *
 * It is about one page. The TikTok comment pages measured on 2026-09-06 came
 * back 48, 49, 45, 49, 48, 50, 50, 50, 50, so a batch is roughly one credit and
 * one call at SocialCrawl and two at ScrapeCreators. A batch of 50
 * classifications is $0.15, so a thread nobody wants is dropped after $0.30
 * rather than after $0.60.
 *
 * Counted in **comments** and not in provider pages, which is a fix of its
 * own: four pages means 100 comments through one provider and 204 through
 * another, and nobody chose that difference.
 */
export const replyBatchSize = 50;

/**
 * Consecutive batches with no match before a thread is abandoned.
 *
 * **One.** The owner chose it on 2026-09-06, after seeing the case for two,
 * and the first live run of the loop supports them for a reason the
 * arithmetic on paper had missed.
 *
 * That arithmetic assumed a batch is exactly `replyBatchSize`. It is not: the
 * walk buys whole pages until it holds fifty, so it overshoots. The live run
 * read positions 50 to 133 in one batch — eighty-four comments, not fifty. An
 * empty batch is therefore stronger evidence than the table below suggests.
 *
 * The chance a batch holds no match, by the thread's true lead rate:
 *
 *     rate      50 comments   84 comments
 *     10%           0.5%          0.02%
 *      5%           7.7%           1.4%
 *      2%          36.4%          18.2%
 *
 * So on a thread worth reading this rule almost never fires, and on a thread
 * running at 2% it fires often — which is the intent. What it costs is the
 * middle: a 5% thread is now abandoned about one batch in seventy rather than
 * one in seven hundred. That is the trade the owner made, and it buys a
 * decision after a single batch — about $0.16 — instead of two.
 *
 * A thread abandoned this way is not abandoned for good: `repliesStoppedAtCount`
 * reopens it when the platform says more has been said.
 */
export const maxEmptyBatches = 1;

/**
 * The most comments one thread may ever buy, across every batch.
 *
 * **This is what protects the bill, not the threshold.** US-048 measured that
 * the threshold almost never fires on a thread worth reading — which is what
 * makes it safe, and also what makes it useless as a spending limit. A
 * classification is 2,975 micro-dollars, so an unbounded read is $2.98 a
 * thousand comments and $297 on a hundred thousand. One thread.
 *
 * Five hundred is a judgement. It is $1.49 of classification at today's
 * prices, it is five times what `maxPagesPerThread` allowed before, and the
 * measurement is the reason it is not smaller: leads sat three times denser at
 * position 400 than at position 0, so a ceiling of 100 would have cut this
 * product off from the better half of a thread.
 */
export const maxCommentsPerThread = 500;

/**
 * How far back a reply may be, when this thread has never been read.
 *
 * A thread outlives the post above it, so `monitors.last_polled_at` is the
 * wrong window here even when there is one: a video collected today can carry
 * comments from 2015, and the poll mark says nothing about them.
 *
 * Ninety days is a judgement rather than a measurement, and it is made in the
 * direction the evidence points. US-034's live YouTube poll returned a comment
 * written in **June 2021** as a lead — 1,915 days old, a person who wanted a
 * Cypress alternative five years ago and has long since chosen one. The mean
 * video in that collection was 655 days old.
 *
 * Only this thread's own last read narrows it. BUG-006 is what happens when
 * the monitor's poll mark is allowed to: the collect step of the same poll had
 * already set that mark to now, so every provider was asked for comments
 * written after the poll started, and no comment on earth is.
 */
export const defaultReplyWindowDays = 90;

/** A post as this step reads it: enough to open a thread and to skip one. */
interface Thread {
  readonly id: string;
  readonly source: string;
  readonly externalId: string;
  readonly url: string;
  readonly replyCount: number | null;
  readonly repliesPartial: boolean | null;
  readonly repliesReadAt: Date | null;
  /** Where the walk resumes. Null on a thread nobody has opened. US-048. */
  readonly repliesCursor: string | null;
  /** The position the last batch began at, so its yield can be counted. */
  readonly repliesBatchStart: number | null;
  readonly repliesEmptyBatches: number;
  readonly repliesStopped: string | null;
  readonly repliesStoppedAtCount: number | null;
  readonly repliesJudgedTo: number;
}

export function createRepliesStep({
  registry,
  credentialsFor,
}: CollectOptions): Step<RepliesPayload> {
  return async function replies(
    { monitorId, postIds },
    { db, boss, logger }: StepContext,
  ): Promise<void> {
    const ids = [...postIds];
    if (ids.length === 0) return;

    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);

    if (!monitor) {
      logger.warn({ monitorId }, "replies skipped: the monitor is gone");
      return;
    }

    if (!monitor.includeReplies) {
      logger.debug({ monitorId }, "replies skipped: this monitor does not read them");
      return;
    }

    /**
     * The guard, before anything is asked of a provider.
     *
     * The same rule the poll follows and for the same reason: a page is billed
     * when it is fetched, so the only place to refuse is before the call. This
     * step can be reached with the cap already spent, because the poll that
     * produced these posts spent some of it.
     */
    const budget = await enforceBudget(db, monitorId);

    if (budget.exhausted) {
      /**
       * Say so on the threads that were mid-walk, then stop.
       *
       * Found by the first live run of the loop: the guard refused a batch and
       * returned, so no thread recorded *why* it had stopped growing. The
       * inbox's "the monitor reached its budget" could never appear, and a
       * short thread read as a judgement about the conversation when it was a
       * judgement about the month — the exact confusion that sentence exists
       * to prevent.
       *
       * Only threads already being read are marked. A thread this job never
       * opened has nothing to explain. And `budget` is the one stop reason
       * `replies` treats as temporary: the check above lets a thread stopped
       * this way resume, because the money runs out, not the conversation.
       */
      await db
        .update(posts)
        .set({ repliesStopped: "budget" })
        .where(
          and(
            inArray(posts.id, ids),
            eq(posts.kind, "post"),
            isNotNull(posts.repliesBatchStart),
            isNull(posts.repliesStopped),
          ),
        );

      logger.warn(
        { monitorId, capMicros: budget.capMicros, reason: budget.reason },
        "replies refused: the monitor is at its budget cap",
      );
      return;
    }

    const candidates: Thread[] = await db
      .select({
        id: posts.id,
        source: posts.source,
        externalId: posts.externalId,
        url: posts.url,
        replyCount: posts.replyCount,
        repliesPartial: posts.repliesPartial,
        repliesReadAt: posts.repliesReadAt,
        repliesCursor: posts.repliesCursor,
        repliesBatchStart: posts.repliesBatchStart,
        repliesEmptyBatches: posts.repliesEmptyBatches,
        repliesStopped: posts.repliesStopped,
        repliesStoppedAtCount: posts.repliesStoppedAtCount,
        repliesJudgedTo: posts.repliesJudgedTo,
      })
      .from(posts)
      // `kind = 'post'` is what stops this looping. A reply has no thread of
      // its own, and opening one would be a second bill for the same words.
      .where(and(inArray(posts.id, ids), eq(posts.kind, "post")));

    /**
     * Which provider fetches each platform, read once per job.
     *
     * The same rule the poll follows, and read the same way: every registered
     * candidate is asked for its key first, because one connected provider is
     * the common deployment and it must not be asked a question it has one
     * answer to. `registry.only` refuses rather than guesses when two could
     * run and nobody has chosen.
     */
    /**
     * The oldest a reply may be on a thread nobody has read yet.
     *
     * Each thread narrows this with its own `repliesReadAt`, below. The
     * monitor's poll mark is deliberately not consulted: it belongs to the
     * search, and this step opens threads the search has just met for the
     * first time.
     */
    const floor = new Date(Date.now() - defaultReplyWindowDays * 86_400_000);

    const choices = await readProviderChoices(db);
    const sources = new Map<string, SocialSource | undefined>();

    const connectorFor = async (source: string): Promise<SocialSource | undefined> => {
      if (sources.has(source)) return sources.get(source);

      const keyed = new Map<string, SourceCredentials>();
      for (const candidate of registry.forPlatform(source)) {
        const found = await credentialsFor(candidate);
        if (found) keyed.set(candidate.provider.id, found);
      }

      let chosen: SocialSource | undefined;

      if (keyed.size > 0) {
        try {
          chosen = registry.only(source, { choices, among: [...keyed.keys()] });
        } catch (error) {
          // Two providers could run and nobody has chosen, or the choice names
          // one that cannot. Retrying fixes neither, and picking for them
          // spends somebody's money on a default.
          logger.error({ monitorId, source, err: error }, "replies skipped for this platform");
          chosen = undefined;
        }
      }

      sources.set(source, chosen);
      return chosen;
    };
    let opened = 0;
    let skipped = 0;
    let pagesBought = 0;
    let spentUnits = 0;
    const storedReplyIds: string[] = [];

    for (const post of candidates) {
      if (opened >= maxThreadsPerJob) {
        logger.info(
          { monitorId, limit: maxThreadsPerJob },
          "replies stopped: this job has opened as many threads as it may",
        );
        break;
      }

      /**
       * The platform says there is nothing under this post.
       *
       * Found live on 2026-09-06, and it cost four credits to find: US-034's
       * YouTube poll opened eleven threads and got seven comments back, having
       * paid a credit for each. Half of those videos had a comment count of
       * zero sitting on the row, unread.
       *
       * Zero is the only count worth refusing on. A thread with one comment may
       * hold the lead — the best match of that run came from a thread with a
       * handful — so anything above zero is bought.
       *
       * Null is not zero and is never refused here. It means the platform did
       * not say, which is the normal state on Reddit and on half of YouTube's
       * own search results.
       */
      if (post.replyCount === 0) {
        skipped += 1;
        continue;
      }

      /**
       * Reading this thread has already been ended, and by what.
       *
       * `threshold`, `ceiling` and `end` are decisions and they hold. `budget`
       * is not a decision about the thread — it is a decision about the month
       * — so a thread stopped by money is picked up again once there is money,
       * and `enforceBudget` above is what stops that being a loop.
       */
      /**
       * More has been said since reading stopped, so the thread opens again.
       *
       * Without this `repliesStopped` is a life sentence. A thread abandoned
       * on two empty batches in March would never be read again however busy
       * it became, which is the case a monitor exists to catch. The count is
       * the platform's own and `collect.ts` refreshes it on every poll.
       */
      const grewSinceStopping =
        post.repliesStopped !== null &&
        post.replyCount !== null &&
        post.repliesStoppedAtCount !== null &&
        post.replyCount > post.repliesStoppedAtCount;

      if (post.repliesStopped !== null && post.repliesStopped !== "budget" && !grewSinceStopping) {
        skipped += 1;
        continue;
      }

      /**
       * The batch before this one held no lead, twice running.
       *
       * US-048's rule, and the arithmetic is under `maxEmptyBatches`. The
       * count is of *consecutive* empty batches, so a thread that goes quiet
       * for fifty comments and then produces a lead has its counter reset
       * rather than carrying a grudge.
       */
      /**
       * Judge the batch that has been classified, **before** buying another.
       *
       * This is the seam between two jobs, and getting it wrong is invisible.
       * `replies` buys a batch and can say nothing about it: the verdicts
       * arrive later, from the classifier. So the judgement is made here, at
       * the start of the next pass, over the range `repliesJudgedTo` and
       * `repliesBatchStart` bound — the comments bought last time and scored
       * since.
       *
       * The first version of this counted matches **after** reading, from the
       * batch it had just bought, which nothing had scored yet. It counted
       * zero every time, so every thread would have died after three batches
       * however good it was. A live run found it before the suite did, because
       * the suite drove one batch per job and never let two batches meet.
       */
      const judgedTo = grewSinceStopping ? 0 : post.repliesJudgedTo;
      const readTo = grewSinceStopping ? 0 : (post.repliesBatchStart ?? 0);
      let emptyBatches = grewSinceStopping ? 0 : post.repliesEmptyBatches;

      if (readTo > judgedTo) {
        const [judged] = await db
          .select({ found: sql<number>`count(*)::int` })
          .from(matches)
          .innerJoin(posts, eq(posts.id, matches.postId))
          .where(
            and(
              eq(matches.monitorId, monitorId),
              eq(posts.parentPostId, post.id),
              gte(posts.threadPosition, judgedTo),
              lt(posts.threadPosition, readTo),
            ),
          );

        const found = judged?.found ?? 0;

        // Consecutive, so a thread that goes quiet and then produces a lead
        // has its counter reset rather than carrying a grudge. At
        // `maxEmptyBatches` of one that reset never gets the chance to matter,
        // and it is kept because the number is a setting rather than a law.
        emptyBatches = found > 0 ? 0 : emptyBatches + 1;

        logger.debug(
          { monitorId, postId: post.id, from: judgedTo, to: readTo, found, emptyBatches },
          "batch judged",
        );

        if (emptyBatches >= maxEmptyBatches) {
          await db
            .update(posts)
            .set({
              repliesStopped: "threshold",
              repliesEmptyBatches: emptyBatches,
              repliesJudgedTo: readTo,
              repliesStoppedAtCount: post.replyCount ?? null,
            })
            .where(eq(posts.id, post.id));

          logger.info(
            { monitorId, postId: post.id, emptyBatches },
            "thread closed: a batch held no lead",
          );
          skipped += 1;
          continue;
        }
      }

      /**
       * Nothing new was said, so nothing is bought.
       *
       * `repliesPartial` is the exception that keeps this honest. A thread we
       * only half read is worth another page even at an unchanged count,
       * because the count was never the reason we stopped.
       */
      if (post.repliesPartial === false && post.replyCount !== null) {
        skipped += 1;
        continue;
      }

      const connector = await connectorFor(post.source);

      // No connector, or one that cannot read replies. The second is the
      // declaration `SocialSource.fetchReplies` makes by being absent, and it
      // is why a monitor may ask for replies on a platform that has none
      // without the poll failing.
      if (!connector?.fetchReplies) {
        skipped += 1;
        continue;
      }

      const credentials = await credentialsFor(connector);
      if (!credentials) {
        skipped += 1;
        continue;
      }

      /**
       * One **batch**, which is pages until `replyBatchSize` comments are held.
       *
       * The walk ends on whichever comes first: the batch being full, the
       * connector saying `done`, the page bound, or a page that returned
       * nothing. The last is not redundant — US-020 measured an X thread whose
       * `has_more: true` led to an empty page, so a cursor is not a promise
       * that anything is behind it.
       *
       * `maxPagesPerThread` survives as a bound on one job rather than on one
       * thread: a batch of 50 is normally one page, and a provider handing
       * back tiny pages must not be able to spend a batch's worth of credits
       * reaching fifty comments.
       */
      let cursor: string | undefined = grewSinceStopping
        ? undefined
        : (post.repliesCursor ?? undefined);
      let pages = 0;
      let partial = true;
      let readThisBatch = 0;
      /**
       * How many items the provider has returned for this thread so far.
       *
       * Counted from `itemsReturned` rather than from the replies we kept, so
       * a page whose items were dropped still moves the numbering on. US-048
       * reads these positions, and a position that closed the gap over a
       * dropped item would say a comment sat higher in the thread than it did.
       */
      let positionOffset = 0;

      /**
       * This thread's own window, and the mark the next read will use.
       *
       * The later of the default and the last time we read this thread. Taken
       * before the first page rather than after the last, so a comment written
       * while the walk was running is read on the next pass instead of being
       * skipped by a mark that had already moved past it.
       */
      const readAt = new Date();

      /**
       * A fresh walk, or the continuation of one.
       *
       * A thread that grew after being closed starts over: its cursor belongs
       * to a walk that has ended, and its batch counter would otherwise carry
       * the old walk's depth into the new one.
       */
      const restarting = grewSinceStopping;
      const firstBatch = restarting || post.repliesBatchStart === null;

      /**
       * The window, and why it is applied **only to the first batch**.
       *
       * Found by a test on 2026-09-06, and it would have been near-invisible
       * live. `repliesReadAt` is written when a walk starts, so a second batch
       * computing `since` from it asks the provider for comments newer than
       * the moment batch one ran — and every comment in the thread is older
       * than that. The batch comes back empty, the threshold reads the empty
       * batch as "nobody here", and a thread is abandoned after two batches
       * having actually been read once.
       *
       * A batch walk is not a search for new comments. It is paging through
       * comments that already exist, from a cursor the provider issued, and
       * the provider decides what is behind that cursor. So the date cut
       * belongs to the start of a walk and nowhere else.
       */
      const since = firstBatch
        ? post.repliesReadAt && post.repliesReadAt > floor
          ? post.repliesReadAt
          : floor
        : floor;

      /**
       * Where this batch starts in the thread, and how much room is left.
       *
       * `repliesBatchStart` is written before the reading, because the
       * threshold counts matches at or after it and a mark written afterwards
       * would count the batch that has just finished.
       */
      const batchStart = restarting ? 0 : (post.repliesBatchStart ?? 0);
      positionOffset = batchStart;

      const roomLeft = maxCommentsPerThread - batchStart;

      if (roomLeft <= 0) {
        await db.update(posts).set({ repliesStopped: "ceiling" }).where(eq(posts.id, post.id));
        logger.info(
          { monitorId, postId: post.id, ceiling: maxCommentsPerThread },
          "thread closed: it has had as many comments as one thread may buy",
        );
        skipped += 1;
        continue;
      }

      const wantThisBatch = Math.min(replyBatchSize, roomLeft);

      while (pages < maxPagesPerThread && readThisBatch < wantThisBatch) {
        const result = await connector.fetchReplies({
          postUrl: post.url,
          postExternalId: post.externalId,
          credentials,
          since,
          positionOffset,
          ...(cursor ? { cursor } : {}),
        });

        pages += 1;
        spentUnits += result.unitsConsumed;
        partial = result.partial;
        positionOffset += result.itemsReturned;
        readThisBatch += result.itemsReturned;

        await recordSourceUsage(db, {
          monitorId,
          source: post.source as Source,
          provider: connector.provider.id as Provider,
          units: result.unitsConsumed,
          // The pair's own price for a reply page, which is not always the
          // price of a search. US-028's lesson: a guard fed the wrong unit
          // price lets a monitor spend a multiple of its cap.
          pricePerUnitMicros: connector.replyPricePerUnitMicros ?? connector.pricePerUnitMicros,
        });

        if (result.replies.length > 0) {
          const stored = await db
            .insert(posts)
            .values(
              result.replies.map((reply) =>
                toReplyRow(
                  post.id,
                  post.source as Source,
                  connector.provider.id as Provider,
                  reply,
                ),
              ),
            )
            .onConflictDoUpdate({
              target: [posts.source, posts.externalId],
              // The same rule the poll follows: refreshing the text here would
              // let a second read resurrect words the author had removed.
              set: { fetchedAt: sql`now()` },
            })
            .returning({ id: posts.id });

          storedReplyIds.push(...stored.map((row) => row.id));
        }

        if (result.next.status !== "ready") break;
        // A cursor that led nowhere. Paging on would ask the same question
        // again and be charged for the same silence.
        if (result.replies.length === 0) break;

        cursor = result.next.cursor;
      }

      opened += 1;
      pagesBought += pages;

      /**
       * What was read, and how honestly.
       *
       * Written from the last answer the connector gave and never from "we ran
       * out of cursors" or "we hit our own page bound". A top-level
       * `has_more: false` arrives on threads missing half their comments, so
       * recording that as complete would mean never coming back for the rest —
       * and a thread this job stopped reading is partial whatever the provider
       * said about the page it stopped on.
       */
      const stoppedEarly = pages >= maxPagesPerThread && partial;

      /**
       * The end of the thread, said by the connector rather than by us.
       *
       * `partial === false` is positive evidence that there is no more, which
       * is a different claim from having run out of cursors. Only that closes
       * a thread as `end`.
       */
      const reachedTheEnd = !partial;
      const reachedTheCeiling = positionOffset >= maxCommentsPerThread;

      const stopped = reachedTheEnd ? "end" : reachedTheCeiling ? "ceiling" : null;

      await db
        .update(posts)
        .set({
          repliesPartial: stoppedEarly ? true : partial,
          // Written when a walk begins and left alone while it runs, so the
          // next walk's window is the moment this one started rather than the
          // moment it happened to finish.
          ...(firstBatch ? { repliesReadAt: readAt } : {}),
          repliesCursor: cursor ?? null,
          repliesBatchStart: positionOffset,
          repliesJudgedTo: readTo,
          repliesEmptyBatches: emptyBatches,
          repliesStopped: stopped,
          // The count reading stopped at, so growth can re-open the thread.
          ...(stopped === null ? {} : { repliesStoppedAtCount: post.replyCount ?? null }),
        })
        .where(eq(posts.id, post.id));

      logger.debug(
        {
          monitorId,
          postId: post.id,
          batchStart,
          readTo: positionOffset,
          emptyBatches,
          stopped,
        },
        "batch read",
      );
    }

    logger.info(
      {
        monitorId,
        posts: candidates.length,
        threadsOpened: opened,
        threadsSkipped: skipped,
        pagesBought,
        replies: storedReplyIds.length,
        floor: floor.toISOString(),
        spentUnits,
      },
      "replies finished",
    );

    if (storedReplyIds.length === 0) return;

    // Back through the filter, where a reply meets triage and nothing else.
    await boss.send(filterQueue, { monitorId, postIds: storedReplyIds });
  };
}

function toReplyRow(
  parentPostId: string,
  sourceId: Source,
  providerId: Provider,
  reply: CandidateReply,
) {
  return {
    source: sourceId,
    provider: providerId,
    externalId: reply.externalId,
    url: reply.url,
    author: reply.author ?? null,
    channel: reply.channel ?? null,
    // A reply has no title of its own. The post's title is its context and it
    // is read through `parent_post_id`, not copied here, so an edited title
    // cannot end up saying two different things in two rows.
    title: null,
    excerpt: reply.text.slice(0, excerptLength),
    postedAt: reply.postedAt,
    kind: "reply" as const,
    parentPostId,
    threadPosition: reply.threadPosition ?? null,
    parentReplyExternalId: reply.parentReplyExternalId ?? null,
  };
}
