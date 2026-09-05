/**
 * Correctness-critical: a deleted post must not be classified again.
 * classify.test.ts pins the exclusion; migration 0019 protects late inserts.
 *
 * The classify step: score every post this poll saw against the monitor, and
 * write a match for the ones that clear the monitor's threshold.
 *
 * This is where money is spent one post at a time, so three rules shape it.
 *
 * **A post is scored once per monitor.** A poll returns every post it saw, new
 * and already stored, because a post one monitor has seen is new to another.
 * That means this step is handed posts it has already paid to classify, and it
 * skips them by asking for the match rather than by trusting the caller.
 *
 * **A failure is bounded.** Every call is recorded, so the count of a post's
 * failed calls survives a restart. Past the limit the post is dropped and
 * logged. Without that, a post the model refuses to score is a bill that
 * repeats on every retry for as long as the monitor exists.
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
import type { MonitorProfile } from "../ai/prompt.js";
import { recordModelCall } from "../ai/record.js";
import {
  type ModelCallOutcome,
  matches,
  modelCalls,
  monitors,
  posts,
  type Signal,
} from "../db/schema.js";
import type { ClassifyPayload } from "./queues.js";
import { notifyQueue } from "./queues.js";
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

    const [candidates, scored, failures] = await Promise.all([
      db
        .select()
        .from(posts)
        .where(and(inArray(posts.id, ids), isNull(posts.deletedAt))),
      db
        .select({ postId: matches.postId })
        .from(matches)
        .where(and(eq(matches.monitorId, monitorId), inArray(matches.postId, ids))),
      db
        .select({ postId: modelCalls.postId, attempts: count() })
        .from(modelCalls)
        .where(
          and(
            eq(modelCalls.monitorId, monitorId),
            inArray(modelCalls.postId, ids),
            // This count is "how often did the model refuse this post". Other
            // kinds of call are recorded in the same table and are not that.
            eq(modelCalls.purpose, "classification"),
            ne(modelCalls.outcome, "scored"),
          ),
        )
        .groupBy(modelCalls.postId),
    ]);

    const alreadyScored = new Set(scored.map((row) => row.postId));
    const attemptsByPost = new Map(failures.map((row) => [row.postId, Number(row.attempts)]));

    const profile = profileOf(monitor);
    const matchIds: string[] = [];
    let retryable = 0;
    let dropped = 0;
    let spentMicros = 0;

    const record = async (
      postId: string,
      outcome: ModelCallOutcome,
      call: ModelCall,
      error?: string,
    ) => {
      spentMicros += call.estimatedCostMicros ?? 0;
      await recordModelCall(db, {
        purpose: "classification",
        outcome,
        call,
        monitorId,
        postId,
        error,
      });
    };

    // One at a time. The provider's rate limit is the binding constraint, and
    // a batch of parallel calls hits it as one burst that the connector-level
    // back-off in `sources/` cannot help with here.
    for (const post of candidates) {
      if (alreadyScored.has(post.id)) continue;

      const attempts = attemptsByPost.get(post.id) ?? 0;

      if (attempts >= maxClassificationAttempts) {
        dropped += 1;
        logger.error(
          { monitorId, postId: post.id, url: post.url, attempts },
          "classification dropped: the model failed on this post too many times",
        );
        continue;
      }

      const outcome = await classifier.classify({ monitor: profile, post });

      if (outcome.status !== "scored") {
        retryable += 1;
        await record(post.id, outcome.status, outcome.call, outcome.error);
        logger.warn(
          { monitorId, postId: post.id, outcome: outcome.status, err: outcome.error },
          "post left unclassified",
        );
        continue;
      }

      await record(post.id, "scored", outcome.call);

      if (outcome.score < monitor.minScore) {
        logger.debug(
          { monitorId, postId: post.id, score: outcome.score, threshold: monitor.minScore },
          "post scored below the monitor's threshold",
        );
        continue;
      }

      const [row] = await db
        .insert(matches)
        .values({ monitorId, postId: post.id, ...scoreColumns(outcome.classification) })
        .onConflictDoNothing({ target: [matches.monitorId, matches.postId] })
        .returning({ id: matches.id });

      if (row) matchIds.push(row.id);
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
      },
      "posts classified",
    );

    // Sent before the throw below, on purpose. The matches above are written
    // and a failure on a later post must not hold back the ones that worked.
    await boss.send(notifyQueue, { monitorId, matchIds });

    if (retryable > 0) {
      throw new Error(
        `${retryable} of ${candidates.length} posts were left unclassified by ${classifier.model}.`,
      );
    }
  };
}
