/**
 * US-049's live proof: one Instagram poll that reads the comments, end to end.
 *
 * An instrument, not a test. The suite proves our half against the payloads
 * `instagram-fixtures/capture.mjs` recorded. What no fixture can answer is
 * whether the whole path works: search, store, open the threads, store the
 * comments, triage them, classify them with the reel above as context, and bill
 * what the connector says it billed.
 *
 *     pnpm --filter @signalscout/core live:instagram-poll
 *
 * **Read the cost before running it. This is the dearest comment platform we
 * have.** A search page is 1 credit. **A comment page is 5**, where TikTok's and
 * YouTube's are 1 — so `maxThreadsPerJob` threads at `maxPagesPerThread` pages
 * is up to 500 credits, about $4. The cap below is what actually bounds it, and
 * exercising that guard is half the point of the run: no live poll in this
 * repository has ever been refused by it, and BUG-004's mid-batch stop has
 * never been reached.
 *
 * **The question this run has to answer is whether a 26-character comment can
 * carry a lead.** US-049's capture measured Instagram comments at a median of
 * 26 characters with none of 29 over sixty, against TikTok's 54 with 22 of 49
 * over sixty on the same kind of thread. US-044 found TikTok's leads in exactly
 * the comments that ran long — a person listing their fungal acne, redness and
 * sensitivity and asking whether a product suited them. If Instagram's comments
 * are half that length, the honest possibility is that there is no such comment
 * here, and this run is how that is found out rather than argued.
 *
 * What it is trying to see, in order:
 *
 *   1. A real search returns reels, stored under the platform and keyed by
 *      Instagram's own id, with the date window the connector always sends.
 *   2. `api_usage` holds rows for the pair, in credits, priced by the connector
 *      — and the search and the comment pages are priced differently.
 *   3. Threads open under the reels the pre-filter kept, and the comments are
 *      stored as `kind = 'reply'` rows linked to their reel.
 *   4. The classifier reads a comment with its reel above it, and what comes
 *      out is readable by a person.
 *   5. Whether anything matches at all, which is this platform's real question.
 */
import { and, desc, eq } from "drizzle-orm";
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
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { apiUsage, budgets, matches, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createClassifyStep } from "../worker/classify.js";
import { createCollectStep } from "../worker/collect.js";
import { credentialsFromStore } from "../worker/credentials.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, repliesQueue } from "../worker/queues.js";
import { createRepliesStep } from "../worker/replies.js";
import type { StepContext } from "../worker/steps.js";
import { builtInSources } from "./index.js";
import { instagramPlatformId } from "./platforms.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * The query the capture used, so the two runs can be compared.
 *
 * Not `flaky tests`, for the reason US-044 established on TikTok and US-049
 * confirmed here: these are consumer platforms, and the words of a trade mean
 * something else on them. This is a monitor whose customers must describe a
 * condition to get a useful answer, which is the only shape that has ever found
 * a lead in a comment section.
 */
const query = "skincare for acne scars";

/**
 * The cap, and on this platform it is the thing that ends the run.
 *
 * A dollar buys about 123 credits: one search page and, at 5 credits each,
 * roughly 24 comment pages. The reply step would happily open 25 threads of up
 * to 4 pages, so this refuses long before the step's own bounds do.
 */
const capMicros = 1_000_000;

const logger = createLogger({ level: "warn", name: "live-instagram" });
const { db, close } = createDatabase(databaseUrl);

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});

/** The one account this instance has, or the pre-account id. US-067. */
const owner = await ownerUserId(db);
const credentialsFor = credentialsFromStore(db, undefined, process.env, logger);

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}`);
}

const aiEnvironment = loadAiEnv(process.env);
const aiConfig = aiConfigFromEnvironment(aiEnvironment);

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(
    `No model key for ${aiConfig.provider}. Set AI_API_KEY, or this run would collect posts and score none.`,
  );
  process.exit(1);
}

const classifier = createClassifier({ config: aiConfig });
const triageConfig = triageConfigFromEnvironment(aiEnvironment);
const triager = createTriager({ config: triageConfig });

const embeddingConfig = embeddingConfigFromEnvironment(aiEnvironment);
const embedder =
  embeddingConfig && !(embeddingNeedsApiKey(embeddingConfig.provider) && !embeddingConfig.apiKey)
    ? createEmbedder({ config: embeddingConfig })
    : undefined;

const collect = createCollectStep({ registry, credentialsFor });
const filter = createFilterStep({
  embedderFor: async () => embedder,
  triagerFor: async () => triager,
});
const replies = createRepliesStep({ registry, credentialsFor });
const classify = createClassifyStep({ classifierFor: async () => classifier });

let unscored: string | undefined;

/** A queue that runs the next step instead of enqueuing it. */
function inlineQueue(context: () => StepContext) {
  const seen: string[] = [];

  const boss = {
    send: async (queue: string, payload: unknown) => {
      const { monitorId, postIds } = (payload ?? {}) as {
        monitorId?: string;
        postIds?: string[];
      };

      if (queue === filterQueue && monitorId && postIds) {
        seen.push(`filter(${postIds.length})`);
        say(`filter: ${postIds.length} items`);
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === repliesQueue && monitorId && postIds) {
        seen.push(`replies(${postIds.length})`);
        say(`replies: opening comment threads under ${postIds.length} reels, 5 credits a page`);
        await replies({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        seen.push(`classify(${postIds.length})`);
        say(`classify: ${postIds.length} items survived the pre-filter`);

        // The step throws when it could not score everything, so pg-boss
        // retries. Right in the worker and wrong here: the items are stored
        // and billed, and dying now would make somebody pay twice to read them.
        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          unscored = error instanceof Error ? error.message : String(error);
        }

        return "inline";
      }

      if (queue === notifyQueue) {
        seen.push("notify");
        return "inline";
      }

      return "inline";
    },
  } as unknown as StepContext["boss"];

  return { boss, seen };
}

async function counts() {
  const rows = await db
    .select({ id: posts.id, kind: posts.kind })
    .from(posts)
    .where(eq(posts.source, instagramPlatformId));

  return {
    posts: rows.filter((row) => row.kind === "post").length,
    replies: rows.filter((row) => row.kind === "reply").length,
  };
}

async function main(): Promise<void> {
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: owner,
      name: "US-049 live Instagram poll",
      /** The same monitor US-044 used on TikTok, so the two are comparable. */
      product: "A moisturiser for acne-prone and sensitive skin, fragrance free",
      idealCustomer:
        "People with acne-prone, oily or sensitive skin who have tried several products",
      problem: "Products for acne dry the skin out or make redness and irritation worse",
      signals: ["recommendation_request", "problem"],
      sources: [instagramPlatformId],
      generatedQueries: { [instagramPlatformId]: [query] },
      generatedSubreddits: [],
      minScore: 50,
      // Not optional on this platform. The reel is not the lead.
      includeReplies: true,
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  const monitorId = monitor.id;

  await db.insert(budgets).values({ monitorId, monthlyCapMicros: capMicros, onExhausted: "pause" });

  const [connector] = registry.forPlatform(instagramPlatformId);

  if (!connector) throw new Error("No Instagram connector is registered.");
  if (!(await credentialsFor(connector, owner))) {
    throw new Error(
      `No credentials for ${connector.provider.id}. Set SOCIALCRAWL_API_KEY, or store one on the connections screen.`,
    );
  }

  const before = await counts();

  say(`monitor ${monitorId}`);
  say(`query "${query}", replies on, cap $${(capMicros / 1_000_000).toFixed(2)}`);
  say(`already stored: ${before.posts} reels, ${before.replies} comments`);
  say(
    `connector: ${connector.platform.id} through ${connector.provider.id}; ` +
      `search ${connector.pricePerUnitMicros} micro-dollars a ${connector.billableUnit}, ` +
      `a comment page ${connector.replyPricePerUnitMicros}`,
  );
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}`);

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, seen } = inlineQueue(() => context());

  await collect({ monitorId }, context());

  const after = await counts();
  const spent = await db
    .select({ units: apiUsage.units, micros: apiUsage.estimatedCostMicros })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId));

  console.log("");
  say(`steps: ${seen.join(" → ")}`);
  say(
    `stored: ${after.posts} reels (${after.posts - before.posts} new), ` +
      `${after.replies} comments (${after.replies - before.replies} new)`,
  );
  say(`api_usage: ${JSON.stringify(spent)}`);
  say(
    `provider spend: $${(spent.reduce((total, row) => total + Number(row.micros ?? 0), 0) / 1_000_000).toFixed(4)}`,
  );

  const threads = await db
    .select({ partial: posts.repliesPartial })
    .from(posts)
    .where(and(eq(posts.source, instagramPlatformId), eq(posts.kind, "post")));

  const opened = threads.filter((row) => row.partial !== null);
  say(
    `threads opened: ${opened.length}; ` +
      `recorded partial: ${opened.filter((row) => row.partial === true).length}`,
  );

  if (unscored) say(`the model did not finish every item: ${unscored}`);

  /**
   * How long the comments this run stored actually are.
   *
   * The capture measured 29 comments on one thread. This is the same
   * measurement over whatever the poll collected, which is the wider sample the
   * platform note needs before it can claim a distribution.
   */
  const stored = await db
    .select({ text: posts.excerpt })
    .from(posts)
    .where(and(eq(posts.source, instagramPlatformId), eq(posts.kind, "reply")));

  if (stored.length > 0) {
    const lengths = stored
      .map((row) => (row.text ?? "").length)
      .sort((left, right) => left - right);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
    say(
      `comment length over ${lengths.length} stored: median ${median}, ` +
        `${lengths.filter((length) => length > 60).length} over sixty. ` +
        "TikTok's skincare thread was median 54, 22 of 49 over sixty.",
    );
  }

  const found = await db
    .select({
      score: matches.score,
      reasons: matches.reasons,
      url: posts.url,
      text: posts.excerpt,
      kind: posts.kind,
      parentId: posts.parentPostId,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .where(eq(matches.monitorId, monitorId))
    .orderBy(desc(matches.score));

  const commentMatches = found.filter((row) => row.kind === "reply");

  say(
    `matches at or above ${monitor.minScore}: ${found.length} ` +
      `(${commentMatches.length} of them comments, ${found.length - commentMatches.length} reels)`,
  );

  for (const match of found) {
    const [parent] = match.parentId
      ? await db.select({ title: posts.title }).from(posts).where(eq(posts.id, match.parentId))
      : [];

    console.log(`\n  ${match.score}  [${match.kind}]  ${match.url}`);
    if (parent) console.log(`     under: ${parent.title ?? "(untitled)"}`);
    console.log(`     ${match.text?.slice(0, 200).replace(/\s+/g, " ")}`);
    for (const reason of match.reasons) console.log(`     - ${reason}`);
  }

  console.log("");
  say("the monitor is left paused, so it spends nothing further");
}

try {
  await main();
} finally {
  await close();
}
