/**
 * Read in full the partial posts the filter kept, then send the batch on to
 * the classifier. US-476.
 *
 * A forum feed that cuts its text gives each new thread as a partial post
 * (`posts.text_partial`): the pre-filter and triage judge the cut, and only a
 * post they keep costs its page here. The rest of the batch passes through
 * untouched, so the classify job is the one the filter would have sent.
 *
 * Every way of not reading a page sends the post on with its partial text: no
 * connector, no key, the cap reached, more posts than one job reads, a page
 * that did not come back. A partial post is still the post's own words, and a
 * lead lost to a provider's bad minute is lost silently. The one exception is
 * a page that shows the thread started before the poll's window: a feed lists
 * an old thread again when someone replies, and that is not a new post. It is
 * dropped as `old_thread`, with the page billed.
 */
import { and, eq, inArray } from "drizzle-orm";
import { enforceBudget, recordSourceUsage } from "../budget/budget.js";
import { monitors, type Provider, posts, type Source } from "../db/schema.js";
import { recordFilterDrops } from "../filter/drops.js";
import { readProviderChoices } from "../sources/choices.js";
import type { CollectOptions } from "./collect.js";
import { excerptLength } from "./collect.js";
import type { ClassifyPayload } from "./queues.js";
import { classifyQueue, forMonitor } from "./queues.js";
import { connectorsFor } from "./replies.js";
import type { Step, StepContext } from "./steps.js";

/**
 * The most pages one job reads. A bound for the reason the replies step has
 * one: the guard runs before the work and cannot know what it will cost.
 */
export const maxCompletionsPerJob = 20;

export function createCompleteStep({
  registry,
  credentialsFor,
}: Pick<CollectOptions, "registry" | "credentialsFor">): Step<ClassifyPayload> {
  return async function complete(payload, { db, boss, logger }: StepContext): Promise<void> {
    const { monitorId } = payload;
    const ids = [...payload.postIds];
    const send = (postIds: readonly string[]) =>
      boss.send(classifyQueue, { ...payload, postIds: [...postIds] }, forMonitor(monitorId));

    const partial =
      ids.length === 0
        ? []
        : await db
            .select({
              id: posts.id,
              source: posts.source,
              url: posts.url,
              since: posts.partialSince,
            })
            .from(posts)
            .where(and(inArray(posts.id, ids), eq(posts.textPartial, true)));
    if (partial.length === 0) {
      await send(ids);
      return;
    }

    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);
    if (!monitor) {
      logger.warn({ monitorId }, "completion skipped: the monitor is gone");
      return;
    }
    const run = { db, logger, monitorId, userId: monitor.userId };

    const budget = await enforceBudget(db, monitorId);
    if (budget.exhausted) {
      logger.warn(
        { monitorId, partial: partial.length, reason: budget.reason },
        "partial posts go on as they are: the monitor is at its budget cap",
      );
      await send(ids);
      return;
    }

    const connectorFor = connectorsFor(
      run,
      registry,
      credentialsFor,
      await readProviderChoices(db, monitor.userId),
    );
    const old: string[] = [];
    let read = 0;
    let units = 0;

    for (const post of partial.slice(0, maxCompletionsPerJob)) {
      const connector = await connectorFor(post.source);
      const credentials = connector?.completePost
        ? await credentialsFor(connector, monitor.userId)
        : null;
      if (!connector?.completePost || !credentials) continue;

      const result = await connector.completePost({
        url: post.url,
        ...(post.since ? { since: post.since } : {}),
        credentials,
      });
      units += result.unitsConsumed;
      if (result.unitsConsumed > 0) {
        await recordSourceUsage(db, {
          userId: monitor.userId,
          monitorId,
          source: post.source as Source,
          provider: connector.provider.id as Provider,
          units: result.unitsConsumed,
          pricePerUnitMicros: connector.pricePerUnitMicros,
        });
      }

      if (result.status !== "complete") {
        if (result.status === "old") old.push(post.id);
        else
          logger.warn(
            { monitorId, url: post.url, reason: result.reason },
            "a partial post goes on as it is",
          );
        continue;
      }
      read += 1;
      await db
        .update(posts)
        .set({
          title: result.post.title ?? null,
          excerpt: result.post.text.slice(0, excerptLength),
          postedAt: result.post.postedAt,
          textPartial: false,
          partialSince: null,
        })
        .where(eq(posts.id, post.id));
    }

    if (old.length > 0)
      await recordFilterDrops(
        db,
        monitorId,
        old.map((postId) => ({ postId, stage: "old_thread" as const, similarity: null })),
      );
    logger.info(
      {
        monitorId,
        partial: partial.length,
        read,
        old: old.length,
        leftPartial: partial.length - read - old.length,
        units,
      },
      "partial posts completed",
    );
    await send(ids.filter((id) => !old.includes(id)));
  };
}
