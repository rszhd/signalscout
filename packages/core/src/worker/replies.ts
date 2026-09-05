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
import { and, eq, inArray, sql } from "drizzle-orm";
import { enforceBudget, recordSourceUsage } from "../budget/budget.js";
import { monitors, type Provider, posts, type Source } from "../db/schema.js";
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

/** A post as this step reads it: enough to open a thread and to skip one. */
interface Thread {
  readonly id: string;
  readonly source: string;
  readonly externalId: string;
  readonly url: string;
  readonly replyCount: number | null;
  readonly repliesPartial: boolean | null;
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

      const result = await connector.fetchReplies({
        postUrl: post.url,
        postExternalId: post.externalId,
        credentials,
      });

      opened += 1;
      spentUnits += result.unitsConsumed;

      await recordSourceUsage(db, {
        monitorId,
        source: post.source as Source,
        provider: connector.provider.id as Provider,
        units: result.unitsConsumed,
        // The pair's own price for a reply page, which is not always the price
        // of a search. US-028's lesson: a guard fed the wrong unit price lets a
        // monitor spend a multiple of its cap.
        pricePerUnitMicros: connector.replyPricePerUnitMicros ?? connector.pricePerUnitMicros,
      });

      /**
       * What was read, and how honestly.
       *
       * `repliesPartial` is written from the connector's own answer and never
       * from "we ran out of cursors". A top-level `has_more: false` arrives on
       * threads that are missing half their comments, so recording that as
       * "complete" would mean never coming back for the rest.
       */
      await db.update(posts).set({ repliesPartial: result.partial }).where(eq(posts.id, post.id));

      if (result.replies.length === 0) continue;

      const stored = await db
        .insert(posts)
        .values(
          result.replies.map((reply) =>
            toReplyRow(post.id, post.source as Source, connector.provider.id as Provider, reply),
          ),
        )
        .onConflictDoUpdate({
          target: [posts.source, posts.externalId],
          // The same rule the poll follows: refreshing the text here would let
          // a second read resurrect words the author had already removed.
          set: { fetchedAt: sql`now()` },
        })
        .returning({ id: posts.id });

      storedReplyIds.push(...stored.map((row) => row.id));
    }

    logger.info(
      {
        monitorId,
        posts: candidates.length,
        threadsOpened: opened,
        threadsSkipped: skipped,
        replies: storedReplyIds.length,
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
    parentReplyExternalId: reply.parentReplyExternalId ?? null,
  };
}
