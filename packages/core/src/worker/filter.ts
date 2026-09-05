/**
 * The pre-filter step: drop the obvious misses before the model is paid to
 * read them.
 *
 * Two stages, in this order, both inside Postgres.
 *
 * 1. **Keyword and subreddit.** Free. `filter/keywords.ts` holds the rule.
 * 2. **Embedding similarity.** One embedding of the monitor's description,
 *    reused until the monitor is edited, and one batch for the posts that got
 *    this far. `pgvector` measures the distance.
 * 3. **Triage.** US-030. A cheap model reads what survived and answers one
 *    question: could this author be a person to reach? `ai/triage.ts` holds
 *    it.
 *
 * An embedding costs about one hundredth of a classification, so the second
 * stage pays for itself as soon as it drops a few posts in a hundred. That is
 * the arithmetic PLAN.md's bring-your-own-key promise rests on.
 *
 * The third stage is not that arithmetic and must not be read as it. Triage is
 * a model call, so it is expensive next to an embedding and cheap only next to
 * a classification. It is here because the two stages above it measure
 * *subject*, and under a post about the right subject the people answering are
 * on subject too. US-029 measured that: no similarity threshold separates a
 * person asking from the experts replying, in either direction, so the job
 * falls to something that can read.
 *
 * **Triage runs inside `pass`, and that is deliberate.** This step has five
 * exits — no embedder, no monitor vector, an embedding call that failed, an
 * empty keep list, and the ordinary end — and every one of them must reach the
 * new stage. docs/testing.md: a rule is only as tested as its least-tested
 * caller. Putting the stage at the one place they all go through leaves no
 * caller to forget it.
 *
 * **Every failure here fails open.** No embedder configured, a provider
 * outage, a model of the wrong width, a monitor that vanished mid-job: the
 * posts go to the classifier. This is deliberate and it is asymmetric on
 * purpose. An extra classification is a cost, on a bill somebody can read. A
 * dropped good lead is invisible — no row, no inbox entry, nothing to notice —
 * and docs/testing.md names this exact swallow as one that needs a test which
 * goes red when the swallowed thing breaks. `filter.test.ts` holds it.
 *
 * **What is dropped is written down.** Every drop goes to `filter_drops` with
 * the similarity that caused it, because a threshold nobody can review against
 * real data is a number somebody guessed twice.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Embedder } from "../ai/embed.js";
import type { MonitorProfile } from "../ai/prompt.js";
import { recordModelCall } from "../ai/record.js";
import type { Triager } from "../ai/triage.js";
import { createSpendMeter } from "../budget/budget.js";
import { monitors, posts, type Signal } from "../db/schema.js";
import { monitorDescriptionText, postEmbeddingText } from "../filter/description.js";
import { type FilterDrop, recordFilterDrops } from "../filter/drops.js";
import { keepsPost, keywordRuleFor } from "../filter/keywords.js";
import { monitorQueries } from "../monitors/monitors.js";
import type { FilterPayload } from "./queues.js";
import { classifyQueue, repliesQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

export interface FilterOptions {
  /**
   * Absent when the deployment has no embedding model, which is the common
   * case on our default provider: Anthropic does not embed. The keyword stage
   * still runs and everything it keeps reaches the classifier.
   */
  readonly embedder?: Embedder;
  /**
   * Absent only in a test that is not about triage.
   *
   * Unlike the embedder above, production always has one: `ai/config.ts` falls
   * every triage setting back to the classifier's, so a deployment that
   * configures nothing still gets the stage on the model it already has. A
   * stage that is off drops nothing, which is safe, but it also saves nothing,
   * and on a comment this is the only paid stage in front of the classifier.
   */
  readonly triager?: Triager;
}

/** A post as both stages read it, which is a row minus what neither needs. */
interface Candidate {
  readonly id: string;
  /**
   * A reply skips the first two stages. US-020, on US-029's measurement.
   *
   * Both of them measure *subject*, and a reply has no subject of its own — it
   * borrows one from the post above it. Checking a reply against the monitor's
   * keywords drops "same here, what did you switch to?" for missing words
   * nobody said to it, and embedding it either drops it for the same reason or,
   * with the parent's title restored, keeps every reply in the thread and costs
   * money to decide nothing. Triage is the stage that can read.
   */
  readonly kind: string;
  /** The platform it came from, which decides the queries it is checked against. */
  readonly source: string;
  readonly channel: string | null;
  readonly title: string | null;
  readonly excerpt: string;
  readonly embedded: boolean;
}

/** Postgres reads a vector from this text form. */
function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export function createFilterStep({ embedder, triager }: FilterOptions = {}): Step<FilterPayload> {
  return async function filter(
    { monitorId, postIds },
    { db, boss, logger }: StepContext,
  ): Promise<void> {
    const ids = [...postIds];

    if (ids.length === 0) {
      await boss.send(classifyQueue, { monitorId, postIds: [] });
      return;
    }

    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);

    if (!monitor) {
      // Deleted between the poll and this job. The classify step makes the
      // same decision for the same reason: retrying would never find it.
      logger.warn({ monitorId }, "pre-filter skipped: the monitor is gone");
      return;
    }

    /** Everything that is still going to the model, and why the rest is not. */
    const deliver = async (survivors: readonly Candidate[], drops: readonly FilterDrop[]) => {
      await recordFilterDrops(db, monitorId, drops);
      await boss.send(classifyQueue, {
        monitorId,
        postIds: survivors.map((candidate) => candidate.id),
      });

      if (!monitor.includeReplies) return;

      /**
       * The threads worth opening, which is only the posts.
       *
       * A reply has no thread of its own, and sending one here would open a
       * second bill for the same words. The step checks `kind` again in SQL,
       * because a queue payload is not a place to keep an invariant.
       *
       * This runs after the classify job is booked, not instead of it: the
       * posts are leads in their own right and must not wait on a provider
       * call to reach the inbox.
       */
      const threads = survivors.filter((candidate) => candidate.kind !== "reply");
      if (threads.length === 0) return;

      await boss.send(repliesQueue, {
        monitorId,
        postIds: threads.map((candidate) => candidate.id),
      });
    };

    /**
     * Triage, then deliver. Every exit below goes through here.
     *
     * **Only an explicit `no` drops.** `ai/triage.ts` decides that and this
     * loop never second-guesses it: a timeout, a refusal, a rate limit or an
     * unreachable provider all come back as `kept`, and the item goes on. The
     * asymmetry is the same one the embedding stage above is built on, and it
     * is sharper here because there is no threshold to inspect afterwards —
     * a refused item leaves one `filter_drops` row and nothing else.
     *
     * The call is per item, because one item is one question and a batch would
     * make one model answer decide several. That is the expensive shape and
     * the honest one.
     */
    const pass = async (survivors: readonly Candidate[], drops: FilterDrop[]) => {
      if (!triager || survivors.length === 0) {
        if (!triager) {
          logger.debug({ monitorId }, "the triage stage is not running: no triager was given");
        }
        await deliver(survivors, drops);
        return;
      }

      const profile: MonitorProfile = {
        product: monitor.product,
        idealCustomer: monitor.idealCustomer,
        problem: monitor.problem,
        signals: monitor.signals as readonly Signal[],
      };

      const survived: string[] = [];
      let triageSpentMicros = 0;
      let unanswered = 0;
      let unasked = 0;

      /**
       * BUG-004. Triage is a model call and is billed like one.
       *
       * When the money runs out this stage stops *calling*, and keeps every
       * item it has not asked about. Running out of budget is not a `no`, and
       * the rule this stage is built on is that only an explicit `no` drops.
       * The classify step refuses the actual spend; letting these through
       * costs nothing here and loses nothing there.
       */
      const meter = await createSpendMeter(db, monitorId);

      for (const candidate of survivors) {
        if (await meter.exhausted()) {
          unasked += 1;
          survived.push(candidate.id);
          continue;
        }

        const outcome = await triager.triage({ monitor: profile, post: candidate });

        triageSpentMicros += outcome.call.estimatedCostMicros ?? 0;
        meter.spent(outcome.call.estimatedCostMicros);
        if (outcome.verdict === null) unanswered += 1;

        await recordModelCall(db, {
          purpose: "triage",
          outcome: outcome.status,
          call: outcome.call,
          monitorId,
          postId: candidate.id,
          error: outcome.error ?? null,
        });

        if (outcome.kept) survived.push(candidate.id);
        else drops.push({ postId: candidate.id, stage: "triage", similarity: null });
      }

      logger.info(
        {
          monitorId,
          posts: survivors.length,
          kept: survived.length,
          droppedByTriage: survivors.length - survived.length,
          unanswered,
          // Items the cap stopped us asking about. They went on unfiltered,
          // which is the expensive direction and the safe one.
          unasked,
          spentMicros: triageSpentMicros,
          model: triager.model,
        },
        "triage finished",
      );

      await deliver(
        survivors.filter((candidate) => survived.includes(candidate.id)),
        drops,
      );
    };

    if (!monitor.preFilterEnabled) {
      // The person turned the pre-filter off, and triage is one of its stages.
      // Running it anyway would be this product deciding that one of the three
      // does not count as filtering, which is not a decision it gets to make.
      logger.info({ monitorId, posts: ids.length }, "pre-filter is off for this monitor");

      // The rows are read even with the filter off, because `deliver` needs to
      // know which of them are posts before it books a thread for one.
      const all: Candidate[] = await db
        .select({
          id: posts.id,
          source: posts.source,
          channel: posts.channel,
          title: posts.title,
          excerpt: posts.excerpt,
          kind: posts.kind,
          embedded: sql<boolean>`${posts.embedding} is not null`,
        })
        .from(posts)
        .where(inArray(posts.id, ids));

      await deliver(all, []);
      return;
    }

    const candidates: Candidate[] = await db
      .select({
        id: posts.id,
        source: posts.source,
        channel: posts.channel,
        title: posts.title,
        excerpt: posts.excerpt,
        kind: posts.kind,
        // The vector itself is never selected. It is a thousand numbers per
        // row that this step never reads: pgvector does the comparing.
        embedded: sql<boolean>`${posts.embedding} is not null`,
      })
      .from(posts)
      .where(inArray(posts.id, ids));

    /**
     * One rule per platform, built once and reused for every post from it.
     *
     * US-027. A post is checked against the queries that could have found it,
     * and never against another platform's. Checking an X post against a
     * Reddit phrase would drop it for missing words nobody asked X for, and
     * checking a Reddit post against a two-word X query would keep almost
     * everything and send the bill to the model.
     */
    const rules = new Map<string, ReturnType<typeof keywordRuleFor>>();

    const ruleFor = (source: string) => {
      const found = rules.get(source);
      if (found) return found;

      const rule = keywordRuleFor({
        queries: monitorQueries(monitor.generatedQueries, source),
        subreddits: monitor.generatedSubreddits,
      });
      rules.set(source, rule);
      return rule;
    };

    const kept: Candidate[] = [];
    const drops: FilterDrop[] = [];

    for (const candidate of candidates) {
      // A reply is not checked against the monitor's words. It answers a post
      // that already matched them, and the words are rarely repeated: "same
      // here, what did you end up using?" shares nothing with the query that
      // found the thread.
      if (candidate.kind === "reply" || keepsPost(ruleFor(candidate.source), candidate)) {
        kept.push(candidate);
      } else {
        drops.push({ postId: candidate.id, stage: "keyword", similarity: null });
      }
    }

    if (!embedder || kept.length === 0) {
      if (!embedder) {
        logger.debug(
          { monitorId, posts: kept.length },
          "the embedding stage is not running: no embedding model is configured",
        );
      }

      logger.info(
        { monitorId, posts: candidates.length, kept: kept.length, droppedByKeyword: drops.length },
        "pre-filter finished",
      );
      await pass(kept, drops);
      return;
    }

    let spentMicros = 0;

    /** Record one embedding call, whatever it returned. It was billed either way. */
    const record = async (
      outcome: "scored" | "failed",
      call: Parameters<typeof recordModelCall>[1]["call"],
      error?: string,
    ) => {
      spentMicros += call.estimatedCostMicros ?? 0;
      await recordModelCall(db, {
        purpose: "embedding",
        outcome,
        call,
        monitorId,
        // One call covers many posts, so it belongs to none of them. The row
        // is on the monitor's bill, which is where the cap reads it.
        postId: null,
        error: error ?? null,
      });
    };

    /**
     * The monitor's description, embedded once and kept until it is edited.
     *
     * `description_embedding_source` holds the text that produced the stored
     * vector, so an edit is found by comparing strings rather than by a writer
     * elsewhere remembering to clear a column.
     */
    const descriptionText = monitorDescriptionText(monitor);
    let monitorVector: readonly number[] | undefined;

    if (monitor.descriptionEmbedding && monitor.descriptionEmbeddingSource === descriptionText) {
      monitorVector = monitor.descriptionEmbedding;
    } else {
      const outcome = await embedder.embed([descriptionText]);
      await record(
        outcome.status === "embedded" ? "scored" : "failed",
        outcome.call,
        outcome.status === "embedded" ? undefined : outcome.error,
      );

      if (outcome.status === "embedded" && outcome.embeddings[0]) {
        monitorVector = outcome.embeddings[0];
        await db
          .update(monitors)
          .set({
            descriptionEmbedding: [...monitorVector],
            descriptionEmbeddingSource: descriptionText,
          })
          .where(eq(monitors.id, monitorId));
      } else {
        logger.error(
          { monitorId, err: outcome.status === "failed" ? outcome.error : "no embedding returned" },
          "the monitor could not be embedded: every post goes to the model",
        );
      }
    }

    if (!monitorVector) {
      logger.info(
        { monitorId, posts: candidates.length, kept: kept.length, droppedByKeyword: drops.length },
        "pre-filter finished without its embedding stage",
      );
      await pass(kept, drops);
      return;
    }

    /**
     * Replies never reach the embedding stage, so they are separated here
     * rather than filtered out of each step below.
     *
     * US-029 measured both settings on two real threads. Embedded alone, a
     * reply's similarity is about its own few words and the shipped threshold
     * drops people who are asking. Embedded under the parent's title, all 46
     * comments landed inside 0.2 of the title's own score and no threshold
     * separated anything. Neither setting is worth an embedding call.
     */
    const embeddable = kept.filter((candidate) => candidate.kind !== "reply");
    const skippedReplies = kept.filter((candidate) => candidate.kind === "reply");

    // Only what is not embedded yet. A post another monitor already embedded
    // costs nothing here, which is the reason the vector lives on the post and
    // not on the pair.
    const toEmbed = embeddable.filter((candidate) => !candidate.embedded);

    if (toEmbed.length > 0) {
      const outcome = await embedder.embed(
        toEmbed.map((candidate) => postEmbeddingText(candidate)),
      );
      await record(
        outcome.status === "embedded" ? "scored" : "failed",
        outcome.call,
        outcome.status === "embedded" ? undefined : outcome.error,
      );

      if (outcome.status === "failed") {
        logger.error(
          { monitorId, posts: toEmbed.length, err: outcome.error },
          "posts could not be embedded: they go to the model unfiltered",
        );
        logger.info(
          {
            monitorId,
            posts: candidates.length,
            kept: kept.length,
            droppedByKeyword: drops.length,
            spentMicros,
          },
          "pre-filter finished without its embedding stage",
        );
        await pass(kept, drops);
        return;
      }

      for (const [index, candidate] of toEmbed.entries()) {
        const embedding = outcome.embeddings[index];
        if (!embedding) continue;

        await db
          .update(posts)
          .set({ embedding: [...embedding] })
          .where(eq(posts.id, candidate.id));
      }
    }

    /**
     * The comparison itself, in Postgres, because pgvector owns the distance.
     *
     * `<=>` is cosine distance, so one minus it is cosine similarity, which is
     * the number the threshold and `filter_drops` both speak in.
     */
    const scored = await db
      .select({
        id: posts.id,
        similarity: sql<number>`1 - (${posts.embedding} <=> ${vectorLiteral(monitorVector)}::vector)`,
      })
      .from(posts)
      .where(
        and(
          inArray(
            posts.id,
            embeddable.map((candidate) => candidate.id),
          ),
          isNotNull(posts.embedding),
        ),
      );

    const similarities = new Map(scored.map((row) => [row.id, Number(row.similarity)]));
    // A reply arrives already past this stage. It was never embedded and was
    // never going to be, so it is not "unmeasured" — it is not measured here.
    const survivors: Candidate[] = [...skippedReplies];
    let unmeasured = 0;

    for (const candidate of embeddable) {
      const similarity = similarities.get(candidate.id);

      // No similarity means the post has no vector: its embedding failed and
      // was skipped above. It goes to the model, like every other failure.
      if (similarity === undefined) {
        unmeasured += 1;
        survivors.push(candidate);
        continue;
      }

      if (similarity >= monitor.similarityThreshold) survivors.push(candidate);
      else drops.push({ postId: candidate.id, stage: "embedding", similarity });
    }

    const droppedByEmbedding = drops.length - (candidates.length - kept.length);

    logger.info(
      {
        monitorId,
        posts: candidates.length,
        kept: survivors.length,
        droppedByKeyword: candidates.length - kept.length,
        droppedByEmbedding,
        unmeasured,
        threshold: monitor.similarityThreshold,
        embedded: toEmbed.length,
        spentMicros,
        model: embedder.model,
      },
      "pre-filter finished",
    );

    await pass(survivors, drops);
  };
}
