/**
 * Does this product's lead rate depend on where the platform ranked a comment?
 *
 *     pnpm --filter @intentwatch/core measure:lead-position <post url>
 *
 * US-048's first acceptance box, and the question the whole ticket rests on.
 *
 * **Why it cannot be assumed.** A platform ranks a comment for a general
 * viewer — likes, replies, recency, whatever holds attention. This product
 * wants intent, and a person asking "would the yumu one be better?" collects
 * no likes, because nobody likes a question. So the provider's page order is
 * not evidence about our order, and the first draft of US-048 treating it as
 * evidence was the mistake the owner caught.
 *
 * Three outcomes, and each wants a different feature:
 *
 *   * **Leads spread evenly.** Batch one honestly predicts batch two, and a
 *     stop rule on yield is a sound estimator.
 *   * **Leads cluster at the top.** A stop rule works but its threshold must
 *     be discounted, because the first batch flatters every later one.
 *   * **Leads cluster at the bottom.** A stop rule is *harmful*: an unanswered
 *     question is exactly the comment with no likes and no replies, which is
 *     what a popularity ordering puts last. US-048 would need inverting.
 *
 * **It samples bands rather than reading everything, because classification is
 * the bill.** Fetching is cheap — one credit buys about fifty comments — and a
 * classification is 2,975 micro-dollars. On TikTok triage barely filters (it
 * kept 56 of 60 on 2026-09-06), so nearly every comment read buys one. Reading
 * a 1,713-comment thread to the end would be about $5 to answer a question two
 * samples can answer.
 *
 * So it pages through the thread cheaply, keeps only the comments inside the
 * bands asked for, and classifies those. Paging still costs a credit a page
 * even where nothing is kept, and the run reports that separately.
 *
 * It writes rows: the comments it kept are stored like any other, with their
 * positions, so the answer can be re-read later without buying the thread
 * again.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { ownerUserId } from "../auth/user.js";
import { recordSourceUsage } from "../budget/budget.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import {
  apiUsage,
  matches,
  modelCalls,
  monitors,
  type Provider,
  posts,
  type Source,
} from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createClassifyStep } from "../worker/classify.js";
import { excerptLength } from "../worker/collect.js";
import { credentialsFromStore } from "../worker/credentials.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue } from "../worker/queues.js";
import type { StepContext } from "../worker/steps.js";
import { builtInSources } from "./index.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";
import type { CandidateReply } from "./types.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * Report from what is stored, buying nothing.
 *
 * A run that was stopped by the budget can be re-read once the cap is raised
 * and the classifier has caught up, without paying for the pages again.
 */
const reportOnly = process.argv.includes("--report-only");

const postUrl = process.argv[2] ?? "";

if (postUrl === "") {
  console.error("Give a post URL that is already stored, and whose thread is deep.");
  process.exit(1);
}

/**
 * The bands to classify, as `start-end` pairs, positions counting from zero.
 *
 * Two by default and at opposite ends, because the hypothesis is about the
 * ends. A middle band can be added once the two ends disagree — there is no
 * point paying to measure the middle of a line that turns out to be flat.
 */
const bands = (process.argv[3] ?? "0-49,400-449")
  .replace("--report-only", "")
  .split(",")
  .map((band) => band.split("-").map(Number))
  .map(([from, to]) => ({ from: from ?? 0, to: to ?? 0 }));

const deepest = Math.max(...bands.map((band) => band.to));

const logger = createLogger({ level: "warn", name: "measure-lead-position" });
const { db, close } = createDatabase(databaseUrl);

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}`);
}

const aiEnvironment = loadAiEnv(process.env);
const aiConfig = aiConfigFromEnvironment(aiEnvironment);

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(`No model key for ${aiConfig.provider}. This run would read nothing.`);
  process.exit(1);
}

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});
/** The one account this instance has, or the pre-account id. US-067. */
const owner = await ownerUserId(db);
const credentialsFor = credentialsFromStore(db, undefined, process.env, logger);

const classifier = createClassifier({ config: aiConfig });
const triageConfig = triageConfigFromEnvironment(aiEnvironment);
const triager = createTriager({ config: triageConfig });

const embeddingConfig = embeddingConfigFromEnvironment(aiEnvironment);
const embedder =
  embeddingConfig && !(embeddingNeedsApiKey(embeddingConfig.provider) && !embeddingConfig.apiKey)
    ? createEmbedder({ config: embeddingConfig })
    : undefined;

const filter = createFilterStep({
  embedderFor: async () => embedder,
  triagerFor: async () => triager,
});
const classify = createClassifyStep({ classifierFor: async () => classifier });

/** A queue that runs the next step instead of enqueuing it. */
function inlineQueue(context: () => StepContext) {
  const boss = {
    send: async (queue: string, payload: unknown) => {
      const { monitorId, postIds } = (payload ?? {}) as {
        monitorId?: string;
        postIds?: string[];
      };

      if (queue === filterQueue && monitorId && postIds) {
        say(`filter: ${postIds.length} comments into triage`);
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        say(`classify: ${postIds.length} comments survived triage`);
        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          say(`the model did not finish every item: ${String(error)}`);
        }
        return "inline";
      }

      if (queue === notifyQueue) return "inline";
      return "inline";
    },
  } as unknown as StepContext["boss"];

  return { boss };
}

function inABand(position: number): boolean {
  return bands.some((band) => position >= band.from && position <= band.to);
}

async function main(): Promise<void> {
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.url, postUrl), eq(posts.kind, "post")))
    .limit(1);

  if (!post) {
    console.error(`${postUrl} is not stored. This run reads a thread under a post we collected.`);
    process.exit(1);
  }

  const [monitor] = await db
    .select()
    .from(monitors)
    .where(sql`${monitors.sources} @> ARRAY[${post.source}]::text[]`)
    .orderBy(desc(monitors.createdAt))
    .limit(1);

  if (!monitor) {
    console.error(`No monitor watches ${post.source}.`);
    process.exit(1);
  }

  const connector = registry.forPlatform(post.source).at(0);

  if (!connector?.fetchReplies) {
    console.error(`No connector reads replies on ${post.source}.`);
    process.exit(1);
  }

  const credentials = await credentialsFor(connector, owner);

  if (!credentials) {
    console.error(`No credentials for ${connector.provider.id}.`);
    process.exit(1);
  }

  say(`thread: ${postUrl}`);
  say(`the platform claims ${post.replyCount ?? "an unknown number of"} comments`);
  say(`monitor "${monitor.name}", min score ${monitor.minScore}`);
  say(`bands: ${bands.map((band) => `${band.from}-${band.to}`).join(", ")}`);
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}`);

  /**
   * The whole walk, with no date window.
   *
   * Deliberately: the question is about position, and a window would remove
   * comments for being old and leave a hole that reads as a position effect.
   */
  let cursor: string | undefined;
  let positionOffset = 0;
  let pagesBought = 0;
  let unitsSpent = 0;
  const kept: CandidateReply[] = [];

  while (!reportOnly && positionOffset <= deepest) {
    const result = await connector.fetchReplies({
      postUrl: post.url,
      postExternalId: post.externalId,
      credentials,
      positionOffset,
      ...(cursor ? { cursor } : {}),
    });

    pagesBought += 1;
    unitsSpent += result.unitsConsumed;
    positionOffset += result.itemsReturned;

    await recordSourceUsage(db, {
      userId: owner,
      monitorId: monitor.id,
      source: post.source as Source,
      provider: connector.provider.id as Provider,
      units: result.unitsConsumed,
      pricePerUnitMicros: connector.replyPricePerUnitMicros ?? connector.pricePerUnitMicros,
    });

    for (const reply of result.replies) {
      if (reply.threadPosition !== undefined && inABand(reply.threadPosition)) kept.push(reply);
    }

    say(
      `page ${pagesBought}: ${result.itemsReturned} items, read to position ${positionOffset - 1}, ` +
        `kept ${kept.length} so far`,
    );

    if (result.next.status !== "ready") break;
    if (result.itemsReturned === 0) break;
    cursor = result.next.cursor;
  }

  if (reportOnly) {
    say("reporting from what is stored; nothing was fetched and nothing was classified");
  } else {
    say(
      `fetched: ${pagesBought} pages, ${unitsSpent} credits, ${kept.length} comments in the bands`,
    );

    if (kept.length === 0) {
      say("nothing in the bands — the thread is shallower than they are");
      return;
    }
  }

  const stored = reportOnly
    ? await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.parentPostId, post.id), eq(posts.kind, "reply")))
    : await db
        .insert(posts)
        .values(
          kept.map((reply) => ({
            source: post.source as Source,
            provider: connector.provider.id as Provider,
            externalId: reply.externalId,
            url: reply.url,
            author: reply.author ?? null,
            channel: reply.channel ?? null,
            title: null,
            excerpt: reply.text.slice(0, excerptLength),
            postedAt: reply.postedAt,
            kind: "reply" as const,
            parentPostId: post.id,
            threadPosition: reply.threadPosition ?? null,
            parentReplyExternalId: reply.parentReplyExternalId ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [posts.source, posts.externalId],
          set: { fetchedAt: sql`now()` },
        })
        .returning({ id: posts.id });

  const { boss } = inlineQueue(() => ({ db, boss, logger }));

  if (!reportOnly) {
    await filter(
      { monitorId: monitor.id, postIds: stored.map((row) => row.id) },
      { db, boss, logger },
    );
  }

  console.log("");

  const rows = await db
    .select({
      position: posts.threadPosition,
      score: matches.score,
      excerpt: posts.excerpt,
      triaged: sql<number>`(select count(*) from ${modelCalls}
        where ${modelCalls.postId} = ${posts.id} and ${modelCalls.purpose} = 'triage')::int`,
      scored: sql<number>`(select count(*) from ${modelCalls}
        where ${modelCalls.postId} = ${posts.id} and ${modelCalls.purpose} = 'classification')::int`,
    })
    .from(posts)
    .leftJoin(matches, and(eq(matches.postId, posts.id), eq(matches.monitorId, monitor.id)))
    .where(
      inArray(
        posts.id,
        stored.map((row) => row.id),
      ),
    );

  say("the answer, by band:");
  console.log("");
  console.log("  band        comments  triaged  classified  matched  rate of classified");

  for (const band of bands) {
    const inBand = rows.filter(
      (row) => (row.position ?? -1) >= band.from && (row.position ?? -1) <= band.to,
    );
    const scored = inBand.filter((row) => row.scored > 0).length;
    const matched = inBand.filter((row) => row.score !== null).length;
    /**
     * Matches over comments **classified**, never over comments read.
     *
     * The first run of this instrument divided by comments read and reported
     * the deep band at 6% when it was 27%: the budget cap had stopped
     * classification after 11 of that band's 50, so 39 comments counted as
     * "not a lead" when nothing had read them. It is the same error
     * `docs/costs.md` names for money — never divide by a count of things you
     * did not pay for — and it flipped the answer this ticket turns on.
     */
    const rate = scored === 0 ? 0 : (matched / scored) * 100;

    console.log(
      `  ${`${band.from}-${band.to}`.padEnd(11)} ${String(inBand.length).padStart(8)} ` +
        `${String(inBand.filter((row) => row.triaged > 0).length).padStart(8)} ` +
        `${String(scored).padStart(11)} ${String(matched).padStart(8)} ` +
        `${rate.toFixed(1).padStart(5)}%`,
    );
  }

  const spend = await db
    .select({
      purpose: modelCalls.purpose,
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${modelCalls.estimatedCostMicros}), 0)::int`,
    })
    .from(modelCalls)
    .where(eq(modelCalls.monitorId, monitor.id))
    .groupBy(modelCalls.purpose);

  const provider = await db
    .select({ micros: sql<number>`coalesce(sum(${apiUsage.estimatedCostMicros}), 0)::int` })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitor.id));

  console.log("");
  say(`model spend for this monitor, all runs: ${JSON.stringify(spend)}`);
  say(`provider spend for this monitor, all runs: ${provider[0]?.micros ?? 0} micro-dollars`);

  console.log("");
  say("the matches, by position:");

  for (const row of rows
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))) {
    console.log(`  #${String(row.position).padStart(4)}  score ${row.score}`);
    console.log(`         ${(row.excerpt ?? "").replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
