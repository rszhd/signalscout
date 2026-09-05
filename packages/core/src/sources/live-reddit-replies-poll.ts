/**
 * US-020's live proof: one Reddit poll that reads the replies, end to end.
 *
 * This is an instrument, not a test. The suite proves our half against
 * captured payloads — including the thread where ScrapeCreators reports
 * `has_more: false` with 33 of 58 comments missing — but nothing in it has ever
 * asked a real provider for a real reply. The claim underneath is that a poll
 * collects posts, opens the threads worth opening, stores what was said,
 * classifies it with the thread as context, and bills what the connector says
 * it billed. The only way to ask that is to ask it.
 *
 *     pnpm --filter @intentwatch/core live:reddit-replies
 *
 * **It spends money and it writes rows.** One credit for the subreddit page,
 * then one per thread opened — at most `maxThreadsPerJob` — so about $0.03 of
 * ScrapeCreators credit. The model is the larger half: every reply that
 * survives buys a triage call, and every reply triage keeps buys a
 * classification. Expect a few hundred triage calls and a few dozen
 * classifications. It leaves behind a paused monitor, its posts and replies,
 * its `api_usage` rows and its matches, which are the evidence.
 *
 * It drives the steps by hand with a queue that runs the next one instead of
 * enqueuing it. The steps are the real ones in the real order, so what runs
 * here is what the worker runs. The order is the part worth watching:
 *
 *     collect → filter → replies → filter → classify
 *
 * The second `filter` is the reply pass, and it must skip the keyword and
 * embedding stages. The `replies` step must not appear a second time, because
 * a reply has no thread of its own and a loop there would buy the same words
 * for ever.
 *
 * What it is trying to see, in order:
 *
 *   1. A real thread comes back, with real nested replies, keyed by Reddit's
 *      own `t1_` fullnames.
 *   2. `posts` holds them as `kind = 'reply'` rows linked to their parent, and
 *      the deduplication key needed no change to make that work.
 *   3. `repliesPartial` is written honestly: a thread we did not finish says so.
 *   4. The classifier reads a reply with its thread above it, and the matches
 *      it finds are readable by a person.
 *   5. A second run opens no thread whose reply count has not moved, which is
 *      the rule that stops an hourly monitor re-buying every conversation.
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
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { apiUsage, budgets, matches, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { singleUserId } from "../monitors/monitors.js";
import { createClassifyStep } from "../worker/classify.js";
import { createCollectStep } from "../worker/collect.js";
import { credentialsFromStore } from "../worker/credentials.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, repliesQueue } from "../worker/queues.js";
import { createRepliesStep } from "../worker/replies.js";
import type { StepContext } from "../worker/steps.js";
import { readProviderChoices } from "./choices.js";
import { builtInSources } from "./index.js";
import { redditPlatformId } from "./platforms.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * One subreddit, and not a keyword.
 *
 * US-022 measured both on the same monitor for the same money: the model's own
 * keyword brought back r/AllFinraExams and r/islam, and one subreddit brought
 * back fifty posts that were all on topic. This run is about replies, so it
 * starts from the discovery mode that does not spend the whole budget proving
 * a point about noise.
 */
const subreddit = "softwaretesting";

/**
 * A cap the poll fits inside, so the guard is exercised rather than bypassed.
 *
 * Larger than the LinkedIn run's because this one buys model calls per reply
 * rather than per post. The replies step refuses to open a thread once the cap
 * is reached, which is the branch no live run has ever taken.
 */
const capMicros = 600_000;

const logger = createLogger({ level: "info", name: "live-reddit-replies" });
const { db, close } = createDatabase(databaseUrl);

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});

const credentialsFor = credentialsFromStore(db, undefined, process.env, logger);

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

function say(line: string): void {
  console.log(`[${since().padStart(7)}] ${line}`);
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
const filter = createFilterStep({ ...(embedder ? { embedder } : {}), triager });
const replies = createRepliesStep({ registry, credentialsFor });
const classify = createClassifyStep({ classifier });

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
        say(`replies: opening threads under ${postIds.length} posts`);
        await replies({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        seen.push(`classify(${postIds.length})`);
        say(`classify: ${postIds.length} items survived the pre-filter`);

        // The step throws when it could not score everything, so pg-boss
        // retries. That is right in the worker and wrong here: the items are
        // stored and billed already, and dying now would make somebody pay
        // twice to read them.
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
    .where(eq(posts.source, redditPlatformId));

  return {
    posts: rows.filter((row) => row.kind === "post").length,
    replies: rows.filter((row) => row.kind === "reply").length,
  };
}

async function usage(monitorId: string) {
  return db
    .select({ units: apiUsage.units, micros: apiUsage.estimatedCostMicros })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId));
}

async function main(): Promise<void> {
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: singleUserId,
      name: "US-020 live Reddit replies",
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      signals: ["recommendation_request", "problem"],
      sources: [redditPlatformId],
      generatedQueries: { [redditPlatformId]: [] },
      generatedSubreddits: [subreddit],
      // US-022 measured 30 as too low inside a topical subreddit: every post
      // there is somewhat relevant and the scores compress upward.
      minScore: 50,
      includeReplies: true,
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  const monitorId = monitor.id;

  await db.insert(budgets).values({ monitorId, monthlyCapMicros: capMicros, onExhausted: "pause" });

  // The recorded choice decides, exactly as the poll decides. Passing `among`
  // without it would make a two-provider deployment ambiguous here and not in
  // the worker, which is the wrong place to differ.
  const connector = registry.only(redditPlatformId, {
    choices: await readProviderChoices(db),
    among: (
      await Promise.all(
        registry
          .forPlatform(redditPlatformId)
          .map(async (candidate) =>
            (await credentialsFor(candidate)) ? candidate.provider.id : undefined,
          ),
      )
    ).filter((id): id is string => id !== undefined),
  });

  if (!connector.fetchReplies) {
    throw new Error(
      `${connector.provider.id} cannot read replies. This run needs a provider that can.`,
    );
  }

  const before = await counts();

  say(`monitor ${monitorId}`);
  say(`r/${subreddit}, replies on, cap $${(capMicros / 1_000_000).toFixed(2)}`);
  say(`already stored: ${before.posts} posts, ${before.replies} replies`);
  say(
    `connector: ${connector.platform.id} through ${connector.provider.id}; ` +
      `${connector.pricePerUnitMicros} micro-dollars a ${connector.billableUnit}, ` +
      `${connector.replyPricePerUnitMicros ?? connector.pricePerUnitMicros} a reply page`,
  );
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}`);

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, seen } = inlineQueue(() => context());

  await collect({ monitorId }, context());

  const after = await counts();
  const spent = await usage(monitorId);

  console.log("");
  say(`steps: ${seen.join(" → ")}`);
  say(
    `stored: ${after.posts} posts (${after.posts - before.posts} new), ` +
      `${after.replies} replies (${after.replies - before.replies} new)`,
  );
  say(`api_usage: ${JSON.stringify(spent)}`);

  const threads = await db
    .select({ url: posts.url, replyCount: posts.replyCount, partial: posts.repliesPartial })
    .from(posts)
    .where(and(eq(posts.source, redditPlatformId), eq(posts.kind, "post")));

  const opened = threads.filter((row) => row.partial !== null);
  say(
    `threads opened: ${opened.length}; ` +
      `recorded partial: ${opened.filter((row) => row.partial === true).length}`,
  );

  if (unscored) say(`the model did not finish every item: ${unscored}`);

  const found = await db
    .select({
      score: matches.score,
      reasons: matches.reasons,
      url: posts.url,
      text: posts.excerpt,
      kind: posts.kind,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .where(eq(matches.monitorId, monitorId))
    .orderBy(desc(matches.score));

  say(
    `matches at or above ${monitor.minScore}: ${found.length} ` +
      `(${found.filter((row) => row.kind === "reply").length} of them replies)`,
  );

  for (const match of found) {
    console.log(`\n  ${match.score}  [${match.kind}]  ${match.url}`);
    console.log(`     ${match.text?.slice(0, 160).replace(/\s+/g, " ")}`);
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
