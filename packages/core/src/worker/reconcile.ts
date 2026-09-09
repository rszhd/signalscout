/**
 * Correctness-critical: removed content must disappear, but an outage must not
 * empty the inbox. reconcile.test.ts was written before this implementation.
 * One global stately job checks at most twenty posts, oldest verification first.
 * Polls take priority. Billed checks use the same budget and ledger as polls.
 */
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { enforceBudget, recordSourceUsage } from "../budget/budget.js";
import {
  matches,
  monitors,
  type Provider,
  posts,
  postVerifications,
  sourceContinuations,
} from "../db/schema.js";
import { readProviderChoices } from "../sources/choices.js";
import type {
  ProviderChoices,
  SocialSource,
  SourceCredentials,
  VerificationResult,
} from "../sources/types.js";
import type { CollectOptions } from "./collect.js";
import { pollQueue } from "./queues.js";
import type { Step } from "./steps.js";

export const maxChecksPerJob = 20;
export function createReconcileStep({
  registry,
  credentialsFor,
  now = () => new Date(),
}: CollectOptions & { now?: () => Date }): Step<Record<string, never>> {
  return async (_, { db, boss, logger }) => {
    const at = now();
    const candidates = await db
      .select({
        match: { id: matches.id, monitorId: matches.monitorId },
        post: { id: posts.id, source: posts.source, externalId: posts.externalId, url: posts.url },
        pending: postVerifications,
      })
      .from(matches)
      .innerJoin(posts, eq(matches.postId, posts.id))
      .leftJoin(postVerifications, eq(postVerifications.postId, posts.id))
      .where(
        and(
          eq(matches.hidden, false),
          isNull(posts.deletedAt),
          or(isNull(postVerifications.postId), lte(postVerifications.nextAttemptAt, at)),
          or(
            sql`${postVerifications.cursor} IS NOT NULL`,
            sql`${matches.lastVerifiedAt} <= ${at}::timestamptz - CASE
      WHEN ${posts.postedAt} > ${at}::timestamptz - interval '7 days'
        THEN CASE WHEN ${matches.readAt} IS NULL THEN interval '1 day' ELSE interval '3 days' END
      ELSE CASE WHEN ${matches.readAt} IS NULL THEN interval '7 days' ELSE interval '30 days' END END`,
          ),
        ),
      )
      .orderBy(asc(matches.lastVerifiedAt), asc(matches.id));
    /**
     * Whose choice decides each check, cached for the length of this job.
     *
     * This is the one reader of the table that walks rows belonging to several
     * accounts, so unlike the poll it cannot read once above the loop: BUG-010
     * is precisely one account's choice deciding another's provider, and a
     * single read here would reintroduce it inside the job that was supposed to
     * be fixed. The cache is bounded by `maxChecksPerJob`, so it holds twenty
     * entries at worst and usually one.
     */
    const choicesByOwner = new Map<string, ProviderChoices>();
    const choicesFor = async (userId: string): Promise<ProviderChoices> => {
      const held = choicesByOwner.get(userId);
      if (held) return held;

      const read = await readProviderChoices(db, userId);
      choicesByOwner.set(userId, read);
      return read;
    };

    const seen = new Set<string>();
    let checked = 0;
    for (const { match, post, pending } of candidates) {
      if (seen.has(post.id)) continue;
      if (checked >= maxChecksPerJob) break;
      const monitorId = pending?.cursor ? pending.monitorId : match.monitorId;
      // A deleted owner cannot be billed to another monitor without a choice.
      if (!monitorId) continue;
      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
      if (!monitor) continue;
      const choices = await choicesFor(monitor.userId);
      const keyed = new Map<string, SourceCredentials>();
      for (const candidate of registry.forPlatform(post.source)) {
        const credentials = await credentialsFor(candidate, monitor.userId);
        if (credentials) keyed.set(candidate.provider.id, credentials);
      }
      let source: SocialSource;
      try {
        source = pending?.cursor
          ? registry.get(post.source, pending.provider)
          : registry.only(post.source, { choices, among: [...keyed.keys()] });
      } catch {
        logger.warn({ postId: post.id }, "verification skipped: provider choice cannot run");
        continue;
      }
      const credentials = keyed.get(source.provider.id);
      if (!source.verify || !credentials) continue;
      if (source.pricePerUnitMicros > 0) {
        if ((await enforceBudget(db, monitorId, at)).exhausted) continue;
        if (!pending?.cursor) {
          const [collection] = await db
            .select({ id: sourceContinuations.id })
            .from(sourceContinuations)
            .where(eq(sourceContinuations.monitorId, monitorId))
            .limit(1);
          if (collection) continue;
          const polls = await boss.findJobs(pollQueue, { key: monitorId });
          if (
            polls.some(
              (job) =>
                job.state === "active" ||
                ((job.state === "created" || job.state === "retry") && job.startAfter <= at),
            )
          )
            continue;
        }
        // Finish an existing check, but do not start one ahead of a due poll.
        if (
          !pending?.cursor &&
          !monitor.pausedAt &&
          monitor.sources.length > 0 &&
          (!monitor.lastPolledAt ||
            monitor.lastPolledAt.getTime() + monitor.pollIntervalSeconds * 1000 <= at.getTime())
        )
          continue;
      }
      seen.add(post.id);
      checked++;
      // Back off failures durably. Never move lastVerifiedAt on an uncertain answer.
      const nextDay = new Date(at.getTime() + 86400000);
      await db
        .insert(postVerifications)
        .values({
          postId: post.id,
          monitorId,
          provider: source.provider.id as Provider,
          cursor: pending?.cursor ?? null,
          nextAttemptAt: nextDay,
        })
        .onConflictDoUpdate({
          target: postVerifications.postId,
          set: { monitorId, provider: source.provider.id as Provider, nextAttemptAt: nextDay },
        });
      let result: VerificationResult;
      try {
        result = await source.verify({
          externalId: post.externalId,
          url: post.url,
          credentials,
          ...(pending?.cursor ? { cursor: pending.cursor } : {}),
        });
      } catch {
        // No provider error body is logged: it can echo credentials or post content.
        logger.warn(
          { postId: post.id, provider: source.provider.id },
          "verification failed; content remains visible",
        );
        continue;
      }
      await db.transaction(async (tx) => {
        await recordSourceUsage(tx, {
          userId: monitor.userId,
          monitorId,
          source: post.source,
          provider: source.provider.id as Provider,
          units: result.unitsConsumed,
          pricePerUnitMicros: source.pricePerUnitMicros,
          now: at,
        });
        if (result.status === "pending") {
          await tx
            .update(postVerifications)
            .set({
              cursor: result.cursor ?? null,
              nextAttemptAt: new Date(Math.max(result.retryAfter.getTime(), at.getTime() + 30000)),
            })
            .where(eq(postVerifications.postId, post.id));
          return;
        }
        if (result.status === "unknown") {
          await tx
            .update(postVerifications)
            .set({ cursor: null })
            .where(eq(postVerifications.postId, post.id));
          return;
        }
        if (result.status === "deleted")
          await tx.update(posts).set({ deletedAt: at }).where(eq(posts.id, post.id));
        await tx
          .update(matches)
          .set({ lastVerifiedAt: at, ...(result.status === "deleted" ? { hidden: true } : {}) })
          .where(eq(matches.postId, post.id));
        await tx.delete(postVerifications).where(eq(postVerifications.postId, post.id));
      });
    }
  };
}
