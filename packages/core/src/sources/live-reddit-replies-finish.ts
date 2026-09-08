#!/usr/bin/env tsx
/**
 * Finish the reply half of US-020's live run, without paying a provider again.
 *
 * `live:reddit-replies` collected the posts, opened 23 threads and stored 328
 * replies, and was then killed part-way through triaging them — so no reply was
 * ever classified and the claim this feature rests on, that a reply is scored
 * with its thread above it, went unproven.
 *
 * The rows are already there and already paid for. This takes the replies that
 * run stored and puts them through the two stages that were left: the filter,
 * where a reply meets triage and nothing else, and the classifier, which reads
 * it with its parent post as context.
 *
 *     pnpm --filter @signalscout/core live:reddit-replies-finish
 *
 * **It spends model calls only.** One triage call per reply, then one
 * classification per reply triage keeps. No provider is asked for anything, so
 * `api_usage` gains nothing and nothing is fetched twice.
 *
 * It is a companion to that instrument rather than a second copy of it: it
 * re-uses the same monitor, so the matches land beside the four the first run
 * already found and the whole poll can be read as one thing.
 */
import { and, desc, eq } from "drizzle-orm";
import { createClassifier } from "../ai/classify.js";
import { aiConfigFromEnvironment, needsApiKey, triageConfigFromEnvironment } from "../ai/config.js";
import { createTriager } from "../ai/triage.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { matches, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createClassifyStep } from "../worker/classify.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, repliesQueue } from "../worker/queues.js";
import type { StepContext } from "../worker/steps.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const monitorName = "US-020 live Reddit replies";
/** How many replies to put through, so one run is bounded and priceable. */
const limit = Number(process.env.LIMIT ?? "400");

const logger = createLogger({ level: "warn", name: "live-reddit-finish" });
const { db, close } = createDatabase(databaseUrl);

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}`);
}

const aiEnvironment = loadAiEnv(process.env);
const aiConfig = aiConfigFromEnvironment(aiEnvironment);

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(`No model key for ${aiConfig.provider}. Set AI_API_KEY.`);
  process.exit(1);
}

const triageConfig = triageConfigFromEnvironment(aiEnvironment);
const classifier = createClassifier({ config: aiConfig });
const triager = createTriager({ config: triageConfig });

/**
 * No embedder, on purpose and not for convenience.
 *
 * US-029 measured both settings on two real threads and neither was worth an
 * embedding call, and the filter step skips the stage for a reply anyway. This
 * run is the live check of that: 328 replies should reach the classifier with
 * no embedding bought.
 */
const filter = createFilterStep({ triagerFor: async () => triager });
const classify = createClassifyStep({ classifierFor: async () => classifier });

let unscored: string | undefined;

function inlineQueue(context: () => StepContext) {
  const seen: string[] = [];

  const boss = {
    send: async (queue: string, payload: unknown) => {
      const { monitorId, postIds } = (payload ?? {}) as {
        monitorId?: string;
        postIds?: string[];
      };

      if (queue === classifyQueue && monitorId && postIds) {
        seen.push(`classify(${postIds.length})`);
        say(`classify: ${postIds.length} replies survived triage`);
        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          unscored = error instanceof Error ? error.message : String(error);
        }
        return "inline";
      }

      // The replies step would open a thread under each of these. They are
      // replies, so it would find nothing — but asking costs a query and says
      // something untrue about what this run is doing.
      if (queue === repliesQueue) {
        seen.push("replies(skipped)");
        return "inline";
      }

      if (queue === filterQueue || queue === notifyQueue) {
        seen.push(queue);
        return "inline";
      }

      return "inline";
    },
  } as unknown as StepContext["boss"];

  return { boss, seen };
}

async function main(): Promise<void> {
  const [monitor] = await db.select().from(monitors).where(eq(monitors.name, monitorName)).limit(1);

  if (!monitor)
    throw new Error(`No monitor named "${monitorName}". Run live:reddit-replies first.`);

  const stored = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.source, "reddit"), eq(posts.kind, "reply")))
    .limit(limit);

  const before = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.monitorId, monitor.id));

  say(`monitor ${monitor.id}, min score ${monitor.minScore}`);
  say(`${stored.length} stored replies to put through triage and the model`);
  say(`${before.length} matches already, all of them posts`);
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}`);

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, seen } = inlineQueue(() => context());

  await filter({ monitorId: monitor.id, postIds: stored.map((row) => row.id) }, context());

  console.log("");
  say(`steps: ${seen.join(" → ")}`);
  if (unscored) say(`the model did not finish every reply: ${unscored}`);

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
    .where(eq(matches.monitorId, monitor.id))
    .orderBy(desc(matches.score));

  const replyMatches = found.filter((row) => row.kind === "reply");

  say(`matches now: ${found.length}, of which ${replyMatches.length} are replies`);

  for (const match of replyMatches) {
    const [parent] = match.parentId
      ? await db.select({ title: posts.title }).from(posts).where(eq(posts.id, match.parentId))
      : [];

    console.log(`\n  ${match.score}  ${match.url}`);
    console.log(`     under: ${parent?.title ?? "(the post is gone)"}`);
    console.log(`     ${match.text?.slice(0, 200).replace(/\s+/g, " ")}`);
    for (const reason of match.reasons) console.log(`     - ${reason}`);
  }

  console.log("");
  say("done; the monitor is still paused");
}

try {
  await main();
} finally {
  await close();
}
