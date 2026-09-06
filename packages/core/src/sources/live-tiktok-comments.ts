/**
 * US-044's last question, asked on comments that are already bought.
 *
 *     pnpm --filter @intentwatch/core live:tiktok-comments
 *
 * **Why this exists beside `live-tiktok-poll.ts`.** That script answers the
 * whole path and BUG-006 stopped it answering the end of it: its first run
 * stored no comment at all, and its second stored 678 and then cost more than
 * the run was authorised to spend. The 678 are in the table. Reading a slice of
 * them costs no provider credit, because the pages were bought once and a
 * stored comment is bought for ever.
 *
 * So this reads a sample of the comments already stored under one monitor and
 * puts them through the two paid stages in the real order: triage, then
 * classification with the video above as context. It searches nothing, opens no
 * thread and bills no provider.
 *
 * **The question is narrow and it is the one the platform rests on.** US-044
 * measured that a TikTok search returns publishers, and that the comments under
 * them hold people describing a condition. Three videos have matched. No
 * comment has ever reached the classifier, so *the reason this platform was
 * integrated has never been tested.*
 *
 * It spends model money and nothing else: one triage call per comment, and one
 * classification per comment triage keeps. At the prices measured on
 * 2026-09-06 — 177 micro-dollars a triage, 2,975 a classification on
 * `gpt-5.6-terra` — sixty comments is about $0.12 if triage keeps a third.
 *
 * The monitor's cap still applies. Both paid stages read the spend meter, so a
 * sample that reaches the cap stops rather than finishing.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { matches, modelCalls, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createClassifyStep } from "../worker/classify.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue } from "../worker/queues.js";
import type { StepContext } from "../worker/steps.js";
import { tikTokPlatformId } from "./platforms.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

/**
 * How many stored comments to read.
 *
 * A sample rather than the lot, because the answer this run is after is
 * qualitative — does a TikTok comment ever read as a lead — and 678
 * classifications cost about eight times what sixty do to answer the same
 * question. Override it with the first argument.
 */
const sampleSize = Number(process.argv[2] ?? 60);

const logger = createLogger({ level: "warn", name: "live-tiktok-comments" });
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
        say(`filter: ${postIds.length} comments into triage`);
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        seen.push(`classify(${postIds.length})`);
        say(`classify: ${postIds.length} comments survived triage`);

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

async function main(): Promise<void> {
  /**
   * The monitor the comments were collected for.
   *
   * The newest TikTok monitor rather than a new one: a comment is scored
   * against the monitor it was collected for, and creating a second would
   * re-ask a question the first has already paid part of.
   */
  const [monitor] = await db
    .select()
    .from(monitors)
    .where(sql`${monitors.sources} @> ARRAY[${tikTokPlatformId}]::text[]`)
    .orderBy(desc(monitors.createdAt))
    .limit(1);

  if (!monitor) {
    console.error("No TikTok monitor. Run `live:tiktok-poll` first.");
    process.exit(1);
  }

  const monitorId = monitor.id;

  /**
   * Comments this monitor has not paid to read yet.
   *
   * `model_calls` is the ledger BUG-003 made the skip read, and it is the right
   * question here too: a comment triage has already answered on must not be
   * asked twice, and this run may be repeated with a larger sample.
   *
   * `NOT EXISTS` rather than `NOT IN`, and the difference is not style. An
   * embedding is charged to the monitor and to no post, so `model_calls` holds
   * rows with a null `post_id` — and `NOT IN` against a set containing one null
   * is null for every row, so the first version of this query selected nothing
   * and reported "nothing left to read" over 678 unread comments.
   */
  const sample = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.source, tikTokPlatformId),
        eq(posts.kind, "reply"),
        isNull(posts.deletedAt),
        sql`not exists (
          select 1 from ${modelCalls}
          where ${modelCalls.monitorId} = ${monitorId}
            and ${modelCalls.postId} = ${posts.id}
        )`,
      ),
    )
    .orderBy(desc(posts.postedAt))
    .limit(sampleSize);

  const stored = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.source, tikTokPlatformId), eq(posts.kind, "reply")));

  say(`monitor ${monitorId} — "${monitor.name}"`);
  say(
    `stored TikTok comments: ${stored[0]?.total ?? 0}; unread by this monitor, sampling ${sample.length}`,
  );
  say(`classifier ${aiConfig.model}, triage ${triageConfig.model}, min score ${monitor.minScore}`);
  say("no provider is called: every comment below was bought once already");

  if (sample.length === 0) {
    say("nothing left to read");
    return;
  }

  const context = (): StepContext => ({ db, boss, logger });
  const { boss, seen } = inlineQueue(() => context());

  await filter({ monitorId, postIds: sample.map((row) => row.id) }, context());

  console.log("");
  say(`steps: filter(${sample.length}) → ${seen.join(" → ")}`);

  const spend = await db
    .select({
      purpose: modelCalls.purpose,
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${modelCalls.estimatedCostMicros}), 0)::int`,
    })
    .from(modelCalls)
    .where(eq(modelCalls.monitorId, monitorId))
    .groupBy(modelCalls.purpose);

  say(`model spend for this monitor, all runs: ${JSON.stringify(spend)}`);

  if (unscored) say(`the model did not finish every item: ${unscored}`);

  const found = await db
    .select({
      score: matches.score,
      reasons: matches.reasons,
      url: posts.url,
      excerpt: posts.excerpt,
      parentId: posts.parentPostId,
    })
    .from(matches)
    .innerJoin(posts, eq(posts.id, matches.postId))
    .where(and(eq(matches.monitorId, monitorId), eq(posts.kind, "reply")))
    .orderBy(desc(matches.score));

  console.log("");
  say(`comment matches at or above ${monitor.minScore}: ${found.length}`);

  const parents = found.length
    ? await db
        .select({ id: posts.id, excerpt: posts.excerpt, url: posts.url })
        .from(posts)
        .where(
          inArray(
            posts.id,
            found.map((row) => row.parentId).filter((id): id is string => id !== null),
          ),
        )
    : [];

  for (const match of found) {
    const parent = parents.find((row) => row.id === match.parentId);

    console.log("");
    console.log(`  ${String(match.score).padStart(3)}  ${match.url}`);
    console.log(`     under: ${(parent?.excerpt ?? "").slice(0, 100)}`);
    console.log(`     said:  ${(match.excerpt ?? "").slice(0, 300)}`);

    for (const reason of match.reasons ?? []) console.log(`     - ${reason}`);
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
