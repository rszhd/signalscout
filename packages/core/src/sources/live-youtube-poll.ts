/**
 * US-034's live proof: one YouTube poll that reads the comments, end to end.
 *
 * An instrument, not a test. The suite proves our half against the payloads
 * `youtube-fixtures/capture.mjs` recorded, and those answered nine questions
 * about the provider. What none of them can answer is whether the whole path
 * works: search, store, open the threads, store the comments, triage them,
 * classify them with the video above as context, and bill what the connector
 * says it billed.
 *
 *     pnpm --filter @intentwatch/core live:youtube-poll
 *
 * **It spends money and it writes rows.** One credit for the search page, then
 * one per thread opened, at most `maxThreadsPerJob` — so under $0.20 of
 * SocialCrawl credit. The model is the larger half, as always: every comment
 * that survives buys a triage call and every one triage keeps buys a
 * classification. A YouTube comment page is 51 rows against Reddit's 25, so
 * expect roughly twice the model spend of the Reddit run per thread.
 *
 * **This is the platform where replies are not an option.** US-034 measured it:
 * a search for `flaky tests` returned 45 results and every one of the first
 * twelve was a tutorial. A video is something published to be seen. So this run
 * turns `includeReplies` on and the interesting number is not how many videos
 * matched — it is how many comments did.
 *
 * What it is trying to see, in order:
 *
 *   1. A real search returns videos, stored under the platform and keyed by
 *      YouTube's own id.
 *   2. `api_usage` holds rows for the pair, in credits, priced by the connector.
 *   3. Threads open under the videos the pre-filter kept, and the comments are
 *      stored as `kind = 'reply'` rows linked to their video.
 *   4. The classifier reads a comment with its video above it, and what comes
 *      out is readable by a person.
 *   5. Whether a video ever matches at all, which is this platform's real
 *      question.
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
import { youTubePlatformId } from "./platforms.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * The same two words the other three platforms were polled with.
 *
 * `flaky tests` ran through Bright Data, ScrapeCreators, SocialCrawl's X
 * endpoint and its LinkedIn one, so a fifth answer joins a comparison that
 * already has four rather than starting a new one.
 */
const query = "flaky tests";

/**
 * A cap this run fits inside, so the guard is exercised rather than bypassed.
 *
 * BUG-004's fix means the classify step now stops at the cap mid-batch, so a
 * run that reaches it stops rather than sailing past. That branch has never
 * been reached live.
 */
const capMicros = 1_000_000;

const logger = createLogger({ level: "warn", name: "live-youtube" });
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
        say(`replies: opening comment threads under ${postIds.length} videos`);
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
    .where(eq(posts.source, youTubePlatformId));

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
      name: "US-034 live YouTube poll",
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      signals: ["recommendation_request", "problem"],
      sources: [youTubePlatformId],
      generatedQueries: { [youTubePlatformId]: [query] },
      generatedSubreddits: [],
      minScore: 50,
      // Not optional on this platform. The video is not the lead.
      includeReplies: true,
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  const monitorId = monitor.id;

  await db.insert(budgets).values({ monitorId, monthlyCapMicros: capMicros, onExhausted: "pause" });

  const [connector] = registry.forPlatform(youTubePlatformId);

  if (!connector) throw new Error("No YouTube connector is registered.");
  if (!(await credentialsFor(connector, owner))) {
    throw new Error(
      `No credentials for ${connector.provider.id}. Set SOCIALCRAWL_API_KEY, or store one on the connections screen.`,
    );
  }

  const before = await counts();

  say(`monitor ${monitorId}`);
  say(`query "${query}", replies on, cap $${(capMicros / 1_000_000).toFixed(2)}`);
  say(`already stored: ${before.posts} videos, ${before.replies} comments`);
  say(
    `connector: ${connector.platform.id} through ${connector.provider.id}; ` +
      `${connector.pricePerUnitMicros} micro-dollars a ${connector.billableUnit}`,
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
    `stored: ${after.posts} videos (${after.posts - before.posts} new), ` +
      `${after.replies} comments (${after.replies - before.replies} new)`,
  );
  say(`api_usage: ${JSON.stringify(spent)}`);

  const threads = await db
    .select({ partial: posts.repliesPartial })
    .from(posts)
    .where(and(eq(posts.source, youTubePlatformId), eq(posts.kind, "post")));

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
      parentId: posts.parentPostId,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .where(eq(matches.monitorId, monitorId))
    .orderBy(desc(matches.score));

  const commentMatches = found.filter((row) => row.kind === "reply");

  say(
    `matches at or above ${monitor.minScore}: ${found.length} ` +
      `(${commentMatches.length} of them comments, ${found.length - commentMatches.length} videos)`,
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
