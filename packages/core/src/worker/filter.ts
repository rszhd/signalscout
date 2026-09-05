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
 *
 * An embedding costs about one hundredth of a classification, so the second
 * stage pays for itself as soon as it drops a few posts in a hundred. That is
 * the arithmetic PLAN.md's bring-your-own-key promise rests on.
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
import { recordModelCall } from "../ai/record.js";
import { monitors, posts } from "../db/schema.js";
import { monitorDescriptionText, postEmbeddingText } from "../filter/description.js";
import { type FilterDrop, recordFilterDrops } from "../filter/drops.js";
import { keepsPost, keywordRuleFor } from "../filter/keywords.js";
import { monitorQueries } from "../monitors/monitors.js";
import type { FilterPayload } from "./queues.js";
import { classifyQueue } from "./queues.js";
import type { Step, StepContext } from "./steps.js";

export interface FilterOptions {
  /**
   * Absent when the deployment has no embedding model, which is the common
   * case on our default provider: Anthropic does not embed. The keyword stage
   * still runs and everything it keeps reaches the classifier.
   */
  readonly embedder?: Embedder;
}

/** A post as both stages read it, which is a row minus what neither needs. */
interface Candidate {
  readonly id: string;
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

export function createFilterStep({ embedder }: FilterOptions = {}): Step<FilterPayload> {
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
    const pass = async (survivors: readonly string[], drops: readonly FilterDrop[]) => {
      await recordFilterDrops(db, monitorId, drops);
      await boss.send(classifyQueue, { monitorId, postIds: [...survivors] });
    };

    if (!monitor.preFilterEnabled) {
      logger.info({ monitorId, posts: ids.length }, "pre-filter is off for this monitor");
      await pass(ids, []);
      return;
    }

    const candidates: Candidate[] = await db
      .select({
        id: posts.id,
        source: posts.source,
        channel: posts.channel,
        title: posts.title,
        excerpt: posts.excerpt,
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
      if (keepsPost(ruleFor(candidate.source), candidate)) kept.push(candidate);
      else drops.push({ postId: candidate.id, stage: "keyword", similarity: null });
    }

    const keptIds = kept.map((candidate) => candidate.id);

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
      await pass(keptIds, drops);
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
      await pass(keptIds, drops);
      return;
    }

    // Only what is not embedded yet. A post another monitor already embedded
    // costs nothing here, which is the reason the vector lives on the post and
    // not on the pair.
    const toEmbed = kept.filter((candidate) => !candidate.embedded);

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
        await pass(keptIds, drops);
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
      .where(and(inArray(posts.id, keptIds), isNotNull(posts.embedding)));

    const similarities = new Map(scored.map((row) => [row.id, Number(row.similarity)]));
    const survivors: string[] = [];
    let unmeasured = 0;

    for (const candidate of kept) {
      const similarity = similarities.get(candidate.id);

      // No similarity means the post has no vector: its embedding failed and
      // was skipped above. It goes to the model, like every other failure.
      if (similarity === undefined) {
        unmeasured += 1;
        survivors.push(candidate.id);
        continue;
      }

      if (similarity >= monitor.similarityThreshold) survivors.push(candidate.id);
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
