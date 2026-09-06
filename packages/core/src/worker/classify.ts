/**
 * Correctness-critical: a deleted post must not be classified again, and a post
 * already scored must not be paid for twice. classify.test.ts pins the deletion
 * exclusion, which migration 0019 also protects against late inserts, and the
 * "a post already scored for this monitor" cases pin the skip.
 *
 * The classify step: score every post this poll saw against the monitor, and
 * write a match for the ones that clear the monitor's threshold.
 *
 * This is where money is spent one post at a time, so three rules shape it.
 *
 * **A post is scored once per monitor, per version.** A poll returns every post
 * it saw, new and already stored, because a post one monitor has seen is new to
 * another. That means this step is handed posts it has already paid to
 * classify, and it skips them by asking the call ledger rather than by trusting
 * the caller. It asks the ledger and not `matches`, which is BUG-003: a post
 * scored below the threshold writes no match, so a skip keyed on `matches`
 * never saw three quarters of what it had paid for and bought those answers
 * again on every poll. The question carries `monitors.version`, because a post
 * scored under version 1 has not been asked version 2's question.
 *
 * The ledger row and the match it produces are written in one transaction. The
 * ledger is now what says a post has been scored, so a match lost between the
 * two writes would be a match nothing scores again.
 *
 * **A failure is bounded.** Every call is recorded, so the count of a post's
 * failed calls survives a restart. Past the limit the post is dropped and
 * logged. Without that, a post the model refuses to score is a bill that
 * repeats on every retry for as long as the monitor exists. The count is per
 * version too: an edited monitor is a different question, and a post the model
 * could not answer three times has not been asked this one.
 *
 * **A failure fails the job.** The posts that were scored are written and
 * their notification is sent before the throw, and the retry skips them, so
 * retrying costs only the posts that failed. Swallowing the failure instead
 * would leave a post unscored with nothing to score it again: the next poll
 * asks the source for what is new, and a post from an hour ago is not.
 */
import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import type { ModelCall } from "../ai/call.js";
import { scoreColumns } from "../ai/classification.js";
import type { Classifier } from "../ai/classify.js";
import type { MonitorProfile, ThreadContext } from "../ai/prompt.js";
import { recordModelCall } from "../ai/record.js";
import { createSpendMeter } from "../budget/budget.js";
import type { Database, Queryable } from "../db/client.js";
import {
  type ModelCallOutcome,
  matches,
  modelCalls,
  monitors,
  posts,
  type Signal,
} from "../db/schema.js";
import type { ClassifyPayload } from "./queues.js";
import { notifyQueue, repliesQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

/**
 * How many times one post may fail against one monitor before it is dropped.
 *
 * Three is two more chances than the first, and it is the number at which a
 * failure stops looking transient. A post that three separate calls could not
 * score is a post this model will not score, and every further attempt is a
 * charge that buys the same answer.
 */
export const maxClassificationAttempts = 3;

export interface ClassifyOptions {
  readonly classifier: Classifier;
}

function profileOf(monitor: typeof monitors.$inferSelect): MonitorProfile {
  return {
    product: monitor.product,
    idealCustomer: monitor.idealCustomer,
    problem: monitor.problem,
    signals: monitor.signals as Signal[],
  };
}

export function createClassifyStep({ classifier }: ClassifyOptions): Step<ClassifyPayload> {
  return async function classify(
    { monitorId, postIds },
    { db, boss, logger }: StepContext,
  ): Promise<void> {
    if (postIds.length === 0) {
      await boss.send(notifyQueue, { monitorId, matchIds: [] });
      return;
    }

    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);

    if (!monitor) {
      // Deleted between the poll and this job. Retrying would never find it.
      logger.warn({ monitorId }, "classification skipped: the monitor is gone");
      return;
    }

    const ids = [...postIds];

    // Both questions are about this monitor at this version, and both are asked
    // of the call ledger. `matches` cannot answer either one: a post scored
    // below the threshold is money spent that leaves no match behind.
    const thisVersion = and(
      eq(modelCalls.monitorId, monitorId),
      eq(modelCalls.monitorVersion, monitor.version),
      inArray(modelCalls.postId, ids),
      // Other kinds of call are recorded in the same table and are not this.
      eq(modelCalls.purpose, "classification"),
    );

    /**
     * The thread above every reply in this batch, in one read.
     *
     * Per post would be one query each and the batch is the whole point of
     * this step. A reply whose parent has since been deleted gets no context
     * rather than a broken prompt: the classifier then sees a short comment
     * with no thread, scores it low, and nobody is told a lie about who wrote
     * what.
     */
    const [candidates, scored, failures, matched] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(and(inArray(posts.id, ids), isNull(posts.deletedAt))),
      db
        .selectDistinct({ postId: modelCalls.postId })
        .from(modelCalls)
        .where(and(thisVersion, eq(modelCalls.outcome, "scored"))),
      db
        .select({ postId: modelCalls.postId, attempts: count() })
        .from(modelCalls)
        // "How often did the model refuse this post", for this question.
        .where(and(thisVersion, ne(modelCalls.outcome, "scored")))
        .groupBy(modelCalls.postId),
      // Not the skip — that is `scored` above. This says which posts are in
      // the inbox already, so a re-score under a new version updates the row
      // it finds instead of announcing it as something new.
      db
        .select({ postId: matches.postId })
        .from(matches)
        .where(and(eq(matches.monitorId, monitorId), inArray(matches.postId, ids))),
    ]);

    const threads = await loadThreads(db, candidates);

    const alreadyScored = new Set(scored.map((row) => row.postId));
    const alreadyMatched = new Set(matched.map((row) => row.postId));
    const attemptsByPost = new Map(failures.map((row) => [row.postId, Number(row.attempts)]));

    const profile = profileOf(monitor);
    const matchIds: string[] = [];
    let retryable = 0;
    let dropped = 0;
    let spentMicros = 0;
    /**
     * BUG-004. The cap can be crossed between the first item and the last.
     *
     * `enforceBudget` answers "may this work start", which is the right
     * question for a poll and the wrong one for a batch. A poll of 23 posts
     * produced 328 replies and 123 classifications on 2026-09-06, and nothing
     * between them asked whether there was any money left.
     */
    const meter = await createSpendMeter(db, monitorId);
    let unspentFor = 0;

    const record = async (
      tx: Queryable,
      postId: string,
      outcome: ModelCallOutcome,
      call: ModelCall,
      error?: string,
    ) => {
      spentMicros += call.estimatedCostMicros ?? 0;
      meter.spent(call.estimatedCostMicros);
      await recordModelCall(tx, {
        purpose: "classification",
        outcome,
        call,
        monitorId,
        monitorVersion: monitor.version,
        postId,
        error,
      });
    };

    // One at a time. The provider's rate limit is the binding constraint, and
    // a batch of parallel calls hits it as one burst that the connector-level
    // back-off in `sources/` cannot help with here.
    for (const post of candidates) {
      if (alreadyScored.has(post.id)) continue;

      /**
       * Out of money, so stop rather than finish the batch.
       *
       * The posts left are not dropped and not marked in any way: they have no
       * `model_calls` row, so a later poll that sees them again classifies
       * them, exactly as a post the model had never reached. That is the whole
       * difference between stopping and losing.
       */
      if (await meter.exhausted()) {
        unspentFor = candidates.length - matchIds.length - retryable - dropped;
        break;
      }

      const attempts = attemptsByPost.get(post.id) ?? 0;

      if (attempts >= maxClassificationAttempts) {
        dropped += 1;
        logger.error(
          { monitorId, postId: post.id, url: post.url, attempts },
          "classification dropped: the model failed on this post too many times",
        );
        continue;
      }

      const outcome = await classifier.classify({
        monitor: profile,
        post: { ...post, ...(threads.get(post.id) ?? {}) },
      });

      if (outcome.status !== "scored") {
        retryable += 1;
        await record(db, post.id, outcome.status, outcome.call, outcome.error);
        logger.warn(
          { monitorId, postId: post.id, outcome: outcome.status, err: outcome.error },
          "post left unclassified",
        );
        continue;
      }

      if (outcome.score < monitor.minScore) {
        await record(db, post.id, "scored", outcome.call);
        logger.debug(
          { monitorId, postId: post.id, score: outcome.score, threshold: monitor.minScore },
          "post scored below the monitor's threshold",
        );
        continue;
      }

      // One transaction, because the ledger row is what stops this post being
      // scored again. Two statements could leave the row written and the match
      // missing, and nothing afterwards would notice or repair it.
      const row = await db.transaction(async (tx) => {
        await record(tx, post.id, "scored", outcome.call);

        const [inserted] = await tx
          .insert(matches)
          .values({ monitorId, postId: post.id, ...scoreColumns(outcome.classification) })
          // A match from an earlier version keeps its row. Its scores are
          // rewritten to the ones this version gave, because the inbox shows
          // the monitor a person has now. What a person did to the row —
          // reading it, saving it, a verdict against the version that earned
          // it — is theirs and is left alone.
          .onConflictDoUpdate({
            target: [matches.monitorId, matches.postId],
            set: scoreColumns(outcome.classification),
          })
          .returning({ id: matches.id });

        return inserted;
      });

      if (row && !alreadyMatched.has(post.id)) matchIds.push(row.id);
    }

    logger.info(
      {
        monitorId,
        posts: candidates.length,
        matches: matchIds.length,
        dropped,
        unclassified: retryable,
        spentMicros,
        model: classifier.model,
        unspentFor,
      },
      "posts classified",
    );

    if (unspentFor > 0) {
      // A person has to be able to tell "the cap stopped this" from "there was
      // nothing to find". A quiet inbox looks the same either way, which is the
      // failure this whole surface is written against.
      logger.warn(
        {
          monitorId,
          left: unspentFor,
          capMicros: meter.state.capMicros,
          reason: meter.state.reason,
        },
        "classification stopped at the budget cap: the posts it did not reach keep their place",
      );
    }

    // Sent before the throw below, on purpose. The matches above are written
    // and a failure on a later post must not hold back the ones that worked.
    await boss.send(notifyQueue, { monitorId, matchIds });

    /**
     * The threads whose next batch is now decidable. US-048.
     *
     * A thread is read fifty comments at a time and the decision to buy the
     * next fifty needs the verdicts on the last fifty — which exist only here,
     * at the end of classification. So this closes the loop: replies buys a
     * batch, the filter and this step judge it, and this sends the thread back
     * for another.
     *
     * The rule itself is deliberately not here. This step knows nothing about
     * batches, thresholds or ceilings; it says "these threads have been
     * judged" and `replies.ts` decides what that is worth. A step that scores
     * posts should not also own how deep a thread is read.
     */
    const parents = await db
      .selectDistinct({ id: posts.parentPostId })
      .from(posts)
      .where(and(inArray(posts.id, ids), eq(posts.kind, "reply")));

    const threadIds = parents.map((row) => row.id).filter((id): id is string => id !== null);

    if (threadIds.length > 0) {
      await boss.send(repliesQueue, { monitorId, postIds: threadIds });
    }

    if (retryable > 0) {
      throw new Error(
        `${retryable} of ${candidates.length} posts were left unclassified by ${classifier.model}.`,
      );
    }

    // Deliberately not a throw. Stopping at a cap is the guard working, and a
    // dead-lettered job would turn a correct refusal into an alarm and then
    // retry it against the same empty budget four more times.
  };
}

/** How much of the parent post the classifier is shown. */
const parentExcerptLength = 600;

/**
 * The thread above each reply in a batch, read in two queries however many
 * replies there are.
 *
 * Two levels, and no more: the post, and the reply directly above. A thread is
 * unbounded in depth and every level is billed as input tokens on every call,
 * and two levels is enough for "same here" to mean something.
 *
 * The parent's body is cut to `parentExcerptLength`. A long post would
 * otherwise crowd out the reply being judged, and a model weighs what it reads
 * most of.
 */
async function loadThreads(
  db: Database,
  candidates: readonly (typeof posts.$inferSelect)[],
): Promise<Map<string, { thread: ThreadContext }>> {
  const replies = candidates.filter((row) => row.kind === "reply" && row.parentPostId !== null);
  if (replies.length === 0) return new Map();

  const parentIds = [...new Set(replies.map((row) => row.parentPostId as string))];
  const parentReplyIds = [
    ...new Set(
      replies
        .map((row) => row.parentReplyExternalId)
        .filter((value): value is string => value !== null),
    ),
  ];

  const [parents, parentReplies] = await Promise.all([
    db
      .select({ id: posts.id, title: posts.title, excerpt: posts.excerpt })
      .from(posts)
      .where(inArray(posts.id, parentIds)),
    parentReplyIds.length === 0
      ? Promise.resolve([] as { externalId: string; excerpt: string }[])
      : db
          .select({ externalId: posts.externalId, excerpt: posts.excerpt })
          .from(posts)
          .where(inArray(posts.externalId, parentReplyIds)),
  ]);

  const postById = new Map(parents.map((row) => [row.id, row]));
  const replyByExternalId = new Map(parentReplies.map((row) => [row.externalId, row]));
  const out = new Map<string, { thread: ThreadContext }>();

  for (const reply of replies) {
    const parent = postById.get(reply.parentPostId as string);
    const above = reply.parentReplyExternalId
      ? replyByExternalId.get(reply.parentReplyExternalId)
      : undefined;

    // A reply whose post has been deleted gets no context rather than a
    // half-built one. The model then reads a short comment and scores it low,
    // which is honest; a prompt naming a thread we cannot show would not be.
    if (!parent) continue;

    out.set(reply.id, {
      thread: {
        postTitle: parent.title,
        postExcerpt: parent.excerpt.slice(0, parentExcerptLength),
        ...(above ? { parentReplyExcerpt: above.excerpt.slice(0, parentExcerptLength) } : {}),
      },
    });
  }

  return out;
}
