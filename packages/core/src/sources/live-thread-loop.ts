/**
 * One deep thread, read by the real loop until the rules stop it. US-048.
 *
 *     pnpm --filter @intentwatch/core live:thread-loop <post url> [cap dollars]
 *
 * **Every other test of this loop turns it by hand.** The suite sends one
 * `replies` job, asserts what one batch did, and sends another. That proves the
 * rules and proves nothing about the loop: in production no one enqueues the
 * next batch — `classify` does, after the classifier has judged the last one,
 * and only if the rules in `replies.ts` agree. This script wires the four steps
 * to each other and then gets out of the way.
 *
 * What it is watching for, in order:
 *
 *   1. A batch is fifty comments, not a page and not a thread.
 *   2. The loop continues itself. Nothing here sends the second job.
 *   3. It stops, and the reason it records is the reason it actually stopped.
 *   4. The money spent is the money the rules said would be spent.
 *
 * **It spends real money and the cap is the only thing bounding it.** A batch
 * is about one credit of provider and fifty classifications, so roughly $0.16.
 * The monitor's cap is passed in and the budget guard is what ends the run on a
 * thread that keeps producing leads — which is itself one of the four stop
 * reasons worth seeing live.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { createClassifier } from "../ai/classify.js";
import {
  aiConfigFromEnvironment,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  needsApiKey,
  triageConfigFromEnvironment,
} from "../ai/config.js";
import { createEmbedder } from "../ai/embed.js";
import { createTriager } from "../ai/triage.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { apiUsage, budgets, matches, modelCalls, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { singleUserId } from "../monitors/monitors.js";
import { createClassifyStep } from "../worker/classify.js";
import { credentialsFromStore } from "../worker/credentials.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, repliesQueue } from "../worker/queues.js";
import { createRepliesStep, maxCommentsPerThread, replyBatchSize } from "../worker/replies.js";
import type { StepContext } from "../worker/steps.js";
import { builtInSources } from "./index.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const postUrl = process.argv[2] ?? "";
const capMicros = Math.round(Number(process.argv[3] ?? "0.60") * 1_000_000);

if (postUrl === "") {
  console.error("Give the URL of a stored post whose thread is deep.");
  process.exit(1);
}

const logger = createLogger({ level: "warn", name: "live-thread-loop" });
const { db, close } = createDatabase(databaseUrl);

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}`);
}

const aiEnvironment = loadAiEnv(process.env);
const aiConfig = aiConfigFromEnvironment(aiEnvironment);

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(`No model key for ${aiConfig.provider}.`);
  process.exit(1);
}

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});
const credentialsFor = credentialsFromStore(db, undefined, process.env, logger);

const classifier = createClassifier({ config: aiConfig });
const triageConfig = triageConfigFromEnvironment(aiEnvironment);
const triager = createTriager({ config: triageConfig });

const embeddingConfig = embeddingConfigFromEnvironment(aiEnvironment);
const embedder =
  embeddingConfig && !(embeddingNeedsApiKey(embeddingConfig.provider) && !embeddingConfig.apiKey)
    ? createEmbedder({ config: embeddingConfig })
    : undefined;

const filter = createFilterStep({ ...(embedder ? { embedder } : {}), triager });
const classify = createClassifyStep({ classifier });
const replies = createRepliesStep({ registry, credentialsFor });

/**
 * A queue that runs the next step instead of enqueuing it.
 *
 * The recursion is the point. `classify` sends a `replies` job, which lands
 * here, which calls `replies` again — so the loop turns under its own power
 * exactly as it would through `pg-boss`, and stops when the rules stop it
 * rather than when this script decides to.
 */
function inlineQueue(context: () => StepContext) {
  let batches = 0;

  const boss = {
    send: async (queue: string, payload: unknown) => {
      const { monitorId, postIds } = (payload ?? {}) as {
        monitorId?: string;
        postIds?: string[];
      };

      if (queue === filterQueue && monitorId && postIds) {
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        await classify({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === repliesQueue && monitorId && postIds) {
        batches += 1;
        say(`batch ${batches}: the loop asked for more of this thread`);
        await replies({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === notifyQueue) return "inline";
      return "inline";
    },
  } as unknown as StepContext["boss"];

  return { boss, batchCount: () => batches };
}

/** What one more batch would cost, from what the last ones actually cost. */
async function costOfContinuing(monitorId: string, commentsRead: number): Promise<string> {
  const [model] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${modelCalls.estimatedCostMicros}), 0)::int`,
    })
    .from(modelCalls)
    .where(eq(modelCalls.monitorId, monitorId));

  const [provider] = await db
    .select({ micros: sql<number>`coalesce(sum(${apiUsage.estimatedCostMicros}), 0)::int` })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId));

  const spent = (model?.micros ?? 0) + (provider?.micros ?? 0);

  if (commentsRead === 0) return "nothing read, so nothing to project from";

  // Priced from what was spent per comment actually read, never from a count
  // of comments. docs/costs.md: cost comes from units, volume from posts.
  const perComment = spent / commentsRead;
  const nextBatch = perComment * replyBatchSize;

  return (
    `spent $${(spent / 1_000_000).toFixed(4)} on ${commentsRead} comments; ` +
    `one more batch of ${replyBatchSize} would be about $${(nextBatch / 1_000_000).toFixed(4)}`
  );
}

async function main(): Promise<void> {
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.url, postUrl), eq(posts.kind, "post")))
    .limit(1);

  if (!post) {
    console.error(`${postUrl} is not stored.`);
    process.exit(1);
  }

  const [template] = await db
    .select()
    .from(monitors)
    .where(sql`${monitors.sources} @> ARRAY[${post.source}]::text[]`)
    .orderBy(desc(monitors.createdAt))
    .limit(1);

  if (!template) {
    console.error(`No monitor watches ${post.source} to copy a product from.`);
    process.exit(1);
  }

  /**
   * A monitor of its own, so the run starts from nothing.
   *
   * Reusing the existing one would skip every comment it has already
   * classified — BUG-003's rule, correct in the worker and wrong here, where
   * the question is what a loop does from a standing start.
   */
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: singleUserId,
      name: `US-048 live thread loop ${new Date().toISOString().slice(0, 16)}`,
      product: template.product,
      idealCustomer: template.idealCustomer,
      problem: template.problem,
      signals: template.signals,
      sources: template.sources,
      generatedQueries: template.generatedQueries,
      generatedSubreddits: [],
      minScore: template.minScore,
      includeReplies: true,
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  await db
    .insert(budgets)
    .values({ monitorId: monitor.id, monthlyCapMicros: capMicros, onExhausted: "pause" });

  say(`thread: ${postUrl}`);
  say(`the platform claims ${post.replyCount ?? "an unknown number of"} comments`);
  say(`monitor ${monitor.id}, min score ${monitor.minScore}, cap $${(capMicros / 1e6).toFixed(2)}`);
  say(`batch ${replyBatchSize}, ceiling ${maxCommentsPerThread}`);
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}`);
  console.log("");

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, batchCount } = inlineQueue(() => context());

  // The only job this script sends. Everything after it is the loop.
  await boss.send(repliesQueue, { monitorId: monitor.id, postIds: [post.id] });

  const [after] = await db
    .select({
      read: posts.repliesBatchStart,
      stopped: posts.repliesStopped,
      empty: posts.repliesEmptyBatches,
    })
    .from(posts)
    .where(eq(posts.id, post.id));

  const found = await db
    .select({
      score: matches.score,
      position: posts.threadPosition,
      excerpt: posts.excerpt,
    })
    .from(matches)
    .innerJoin(posts, eq(posts.id, matches.postId))
    .where(and(eq(matches.monitorId, monitor.id), eq(posts.kind, "reply")))
    .orderBy(posts.threadPosition);

  console.log("");
  say(`batches: ${batchCount()}`);
  say(`read to position ${after?.read ?? 0} of a claimed ${post.replyCount ?? "?"}`);
  say(`stopped: ${after?.stopped ?? "still open"}, consecutive empty batches ${after?.empty ?? 0}`);
  say(await costOfContinuing(monitor.id, after?.read ?? 0));

  const spend = await db
    .select({
      purpose: modelCalls.purpose,
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${modelCalls.estimatedCostMicros}), 0)::int`,
    })
    .from(modelCalls)
    .where(eq(modelCalls.monitorId, monitor.id))
    .groupBy(modelCalls.purpose);

  say(`model: ${JSON.stringify(spend)}`);

  console.log("");
  say(`matches: ${found.length}`);

  for (const match of found) {
    console.log(
      `  #${String(match.position).padStart(4)}  ${String(match.score).padStart(3)}  ${(match.excerpt ?? "").replace(/\s+/g, " ").slice(0, 90)}`,
    );
  }

  console.log("");
  say("the monitor is left paused, so it spends nothing further");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
