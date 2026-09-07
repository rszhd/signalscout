/**
 * US-028's live proof: one LinkedIn poll, through the worker, end to end.
 *
 * This is an instrument, not a test. The suite proves our half against
 * captured payloads; the claim underneath is that a real poll collects real
 * posts, stores them, bills what the connector says it billed, and produces
 * matches a person can read. The only way to ask that is to ask it.
 *
 *     pnpm --filter @intentwatch/core live:linkedin-poll
 *
 * **It spends money and it writes rows.** Ten SocialCrawl credits at most —
 * two pages of one query, five credits each, about $0.081 — plus one model
 * call per post that survives the pre-filter. It leaves behind a paused
 * monitor, its posts, one `api_usage` row and whatever matches the model
 * found, which are the evidence.
 *
 * It drives the four steps by hand rather than through `pg-boss`, with a queue
 * that runs the next step instead of enqueuing it. The steps are the real
 * ones, in the real order, so what runs here is what the worker runs.
 *
 * What it is trying to see, in order:
 *
 *   1. A LinkedIn search returns real posts and they are stored under the
 *      platform, deduplicated by LinkedIn's own activity id.
 *   2. `api_usage` holds one row for the pair, in credits, priced by the
 *      connector rather than by anybody's assumption.
 *   3. The pre-filter drops what it drops, and the count is worth knowing:
 *      every post it keeps costs a model call.
 *   4. The model scores them, and the matches above `min_score` are readable.
 *
 * Run it a second time to prove deduplication: the same query inside the same
 * window should store no new post, and should bill again, because the provider
 * charges for the search and not for what is new in it.
 */
import { desc, eq } from "drizzle-orm";
import { createClassifier } from "../ai/classify.js";
import {
  aiConfigFromEnvironment,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  needsApiKey,
} from "../ai/config.js";
import { createEmbedder } from "../ai/embed.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import type { Provider } from "../db/schema.js";
import { apiUsage, budgets, matches, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { singleUserId } from "../monitors/monitors.js";
import { createClassifyStep } from "../worker/classify.js";
import { createCollectStep } from "../worker/collect.js";
import { credentialsFromStore } from "../worker/credentials.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, pollQueue } from "../worker/queues.js";
import type { StepContext } from "../worker/steps.js";
import { setProviderChoice } from "./choices.js";
import { builtInSources } from "./index.js";
import { linkedInPlatformId } from "./platforms.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * One query, and it is the two-word one.
 *
 * The capture measured both: six words returned ten posts with eight on topic,
 * two words returned ten that were all on topic. Two words is the better query
 * and it is also the one US-006 polled on X, so the two platforms can be
 * compared on one question rather than on two.
 */
const query = "flaky tests";

/**
 * A cap the poll fits inside, so the guard is exercised rather than bypassed.
 *
 * Two pages is ten credits, about $0.081. A cap of $0.20 leaves room for the
 * poll and refuses a second one that ran away.
 */
const capMicros = 200_000;

/**
 * Which provider fetches LinkedIn for this run.
 *
 * LinkedIn has had two since US-057, and they are not alternatives that happen
 * to differ in price: SocialCrawl bills five credits for ten relevance-ranked
 * posts, and Apify bills every post it returns and answers with the last hour.
 * Naming one is therefore part of the measurement, not a detail. Without the
 * flag the first registered wins, which is what this script always did.
 */
const wantedProvider = process.argv
  .filter((argument) => argument.startsWith("--provider="))
  .map((argument) => argument.slice("--provider=".length))[0];

/**
 * How many times a poll may be resumed before this script gives up.
 *
 * Apify's runs are asynchronous, so a collection is started, waited for and
 * read across separate poll jobs. Ten resumes at a few seconds each is far
 * beyond the 3 to 11 seconds measured, and it stops a stuck run turning this
 * into an unbounded loop.
 */
const maxResumes = 10;

let resumes = 0;

const logger = createLogger({ level: "info", name: "live-linkedin" });
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

/**
 * The model, built the way the worker builds it.
 *
 * A missing key stops the run rather than collecting posts nobody will read.
 * The collection is the part that costs money, so spending it and then finding
 * there is no classifier is the one order that wastes the whole run.
 */
const aiConfig = aiConfigFromEnvironment(loadAiEnv(process.env));

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(
    `No model key for ${aiConfig.provider}. Set AI_API_KEY, or this run would collect posts and score none.`,
  );
  process.exit(1);
}

const classifier = createClassifier({ config: aiConfig });

const embeddingConfig = embeddingConfigFromEnvironment(loadAiEnv(process.env));
const embedder =
  embeddingConfig && !(embeddingNeedsApiKey(embeddingConfig.provider) && !embeddingConfig.apiKey)
    ? createEmbedder({ config: embeddingConfig })
    : undefined;

const collect = createCollectStep({ registry, credentialsFor });
const filter = createFilterStep(embedder ? { embedder } : {});
const classify = createClassifyStep({ classifier });

/** What the classify step complained about, if it could not finish. */
let unscored: string | undefined;

/**
 * A queue that runs the next step instead of enqueuing it.
 *
 * The steps hand work on through `boss.send`, so driving them by hand means
 * standing in for the queue. Nothing is retried and nothing is batched, which
 * is the difference from the worker and the reason this is an instrument
 * rather than a test of the queue.
 */
function inlineQueue(context: () => StepContext) {
  const seen: string[] = [];

  const boss = {
    send: async (queue: string, payload: unknown, options?: unknown) => {
      seen.push(queue);

      if (queue === filterQueue) {
        const { monitorId, postIds } = payload as { monitorId: string; postIds: string[] };
        say(`filter: ${postIds.length} collected posts`);
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue) {
        const { monitorId, postIds } = payload as { monitorId: string; postIds: string[] };
        say(`classify: ${postIds.length} posts survived the pre-filter`);

        // The classify step throws when it could not score every post, so
        // `pg-boss` retries the ones it missed. That is right in the worker and
        // wrong here: the posts are already stored and billed, the matches it
        // did find are already written, and dying now would make somebody pay
        // for the collection twice to read them. Report it and go on.
        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          unscored = error instanceof Error ? error.message : String(error);
        }

        return "inline";
      }

      // Apify's runs are asynchronous, so `collect` hands back a wait and books
      // itself again. In the worker that is a delayed job; here it is this
      // branch, and without it the run would be started, paid for and never
      // read. `startAfter` is honoured rather than ignored, because resuming
      // early costs a wasted status call and the connector already chose the
      // interval.
      if (queue === pollQueue) {
        resumes += 1;

        if (resumes > maxResumes) {
          say(`giving up after ${maxResumes} resumes; the run never finished`);
          return "inline";
        }

        const wakeAt = (options as { startAfter?: Date } | undefined)?.startAfter;
        const waitMs = wakeAt ? Math.max(0, wakeAt.getTime() - Date.now()) : 0;

        say(`collect: resume ${resumes} in ${(waitMs / 1000).toFixed(1)}s`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        const { monitorId } = payload as { monitorId: string };
        await collect({ monitorId }, context());
        return "inline";
      }

      if (queue === notifyQueue) {
        const { matchIds } = payload as { matchIds: string[] };
        say(`notify: ${matchIds.length} matches (not delivered — no transport here)`);
        return "inline";
      }

      return "inline";
    },
  } as unknown as StepContext["boss"];

  return { boss, seen };
}

async function storedPosts(): Promise<number> {
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.source, linkedInPlatformId));

  return rows.length;
}

async function usage(monitorId: string) {
  return db
    .select({
      source: apiUsage.source,
      provider: apiUsage.provider,
      units: apiUsage.units,
      micros: apiUsage.estimatedCostMicros,
    })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId));
}

async function main(): Promise<void> {
  // Paused, so the dev worker's scheduler never picks it up. This script polls
  // it by hand; a second poller would spend money nobody is watching.
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: singleUserId,
      name: "US-028 live LinkedIn poll",
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      signals: ["recommendation_request", "problem"],
      sources: [linkedInPlatformId],
      generatedQueries: { [linkedInPlatformId]: [query] },
      generatedSubreddits: [],
      // US-022 measured this: inside a topical result set every post is
      // somewhat relevant and the scores compress upward, so 30 lets noise
      // through. 50 is the number that left nine real matches there.
      minScore: 50,
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  const monitorId = monitor.id;

  await db.insert(budgets).values({
    monitorId,
    monthlyCapMicros: capMicros,
    onExhausted: "pause",
  });

  // Before anything is spent. A key missing here would otherwise be found
  // after the provider had already been paid for a page.
  const registered = registry.forPlatform(linkedInPlatformId);
  const connector = wantedProvider
    ? registered.find((candidate) => candidate.provider.id === wantedProvider)
    : registered[0];

  if (!connector) {
    throw new Error(
      wantedProvider
        ? `No LinkedIn connector for provider "${wantedProvider}". ` +
            `Registered: ${registered.map((one) => one.provider.id).join(", ") || "(none)"}.`
        : "No LinkedIn connector is registered.",
    );
  }

  if (!(await credentialsFor(connector))) {
    throw new Error(
      `No credentials for ${connector.provider.id}. Set its key in .env, or store one on the connections screen.`,
    );
  }

  // The poll asks the registry rather than this script, so a build with two
  // LinkedIn connectors has to be told which one to use or it refuses. Writing
  // the choice down is what a person would do on the connections screen.
  // The id came from the connector the registry built, so it is a real
  // provider by construction; the cast is only telling the compiler what the
  // registry already guarantees.
  await setProviderChoice(db, linkedInPlatformId, connector.provider.id as Provider);

  const before = await storedPosts();

  say(`monitor ${monitorId}`);
  say(`query "${query}", cap $${(capMicros / 1_000_000).toFixed(2)}`);
  say(`${before} LinkedIn posts already stored`);
  say(
    `connector: ${connector.platform.id} through ${connector.provider.id}, ` +
      `${connector.pricePerUnitMicros} micro-dollars per ${connector.billableUnit}`,
  );

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, seen } = inlineQueue(() => context());

  await collect({ monitorId }, context());

  const after = await storedPosts();
  const spent = await usage(monitorId);

  say(`posts stored: ${after} (was ${before}, so ${after - before} new)`);
  say(`api_usage: ${JSON.stringify(spent)}`);
  say(`steps that ran: ${seen.join(" → ")}`);

  const found = await db
    .select({
      score: matches.score,
      reasons: matches.reasons,
      url: posts.url,
      text: posts.excerpt,
    })
    .from(matches)
    .innerJoin(posts, eq(matches.postId, posts.id))
    .where(eq(matches.monitorId, monitorId))
    .orderBy(desc(matches.score));

  if (unscored) {
    // A real one of these happened on the first run: one of twenty answers
    // timed out. The post keeps its place and the worker would retry it, which
    // is the behaviour this line is reporting rather than hiding.
    say(`the model did not finish every post: ${unscored}`);
  }

  say(`matches at or above ${monitor.minScore}: ${found.length}`);

  for (const match of found) {
    console.log(`\n  ${match.score}  ${match.url}`);
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
