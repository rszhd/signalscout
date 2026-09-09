/**
 * US-093's last question: does a match actually reach a person?
 *
 *     pnpm --filter @signalscout/core live:notification [sample]
 *
 * **It calls no provider.** The posts it reads are already in the table, bought
 * once and stored for ever, so the provider half of this run is zero — the same
 * shape as `live:tiktok-comments`. It spends model money only: one triage call
 * per post and one classification per post triage keeps. Twelve posts is about
 * three cents on `gpt-5.6-terra`.
 *
 * **What is being asked.** US-016 built digests, immediate alerts and signed
 * webhooks on 2026-09-05 and nothing was ever delivered: on 2026-09-09 the
 * running instance held zero rows in `notification_settings` and zero in
 * `notification_deliveries`, against 174 posts and 20 matches. US-093 made a
 * new monitor notify its owner by default. Every part of that is covered by the
 * suite except the last one, which no test can ask — that a real message leaves
 * this machine and arrives.
 *
 * So, in order:
 *
 *   1. Creating a monitor writes a `notification_settings` row, addressed to
 *      the owner's account, with email on because this deployment can send.
 *   2. Posts already stored are filtered and classified against it, and the
 *      matches are new — found *after* the row was written, which is what
 *      `enabled_since` requires and why a backlog is never delivered.
 *   3. `processNotifications` builds a delivery and hands it to the **real**
 *      transport, the one `createNotificationTransport` builds from the SMTP
 *      settings in `.env`. US-092 proved that transport carries a verification
 *      link to a real inbox; nothing has carried a match through it.
 *
 * **The clock is moved forward and nothing else is.** A digest is due 24 hours
 * after the monitor is created, so `processNotifications` is given a `now` past
 * that moment. That is exactly what the worker will do tomorrow. The message,
 * the matches in it, the transport and the recipient are all real.
 *
 * It leaves behind a paused monitor, its settings row, its matches and its
 * delivery rows, which are the evidence.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createClassifier } from "../ai/classify.js";
import {
  aiConfigFromEnvironment,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  needsApiKey,
  triageConfigFromEnvironment,
} from "../ai/config.js";
import { createEmbedder } from "../ai/embed.js";
import { readAiEnvironment } from "../ai/settings.js";
import { createTriager } from "../ai/triage.js";
import { ownerUserId } from "../auth/user.js";
import { loadAiEnv, loadNotificationEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import {
  budgets,
  matches,
  modelCalls,
  notificationDeliveries,
  notificationItems,
  notificationSettings,
  posts,
  users,
} from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createMonitor } from "../monitors/monitors.js";
import { redditPlatformId } from "../sources/platforms.js";
import { createClassifyStep } from "../worker/classify.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue } from "../worker/queues.js";
import type { StepContext } from "../worker/steps.js";
import { processNotifications } from "./deliver.js";
import { createNotificationTransport, notificationReadiness } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const args = process.argv.slice(2);

/**
 * How many stored posts to score.
 *
 * Small on purpose. The question is whether one message leaves, not how well
 * the classifier reads, and every post here is a model call somebody pays for.
 */
const sampleSize = Number(args.find((arg) => !arg.startsWith("--")) ?? 12);

/**
 * Which subreddit to read, when the sample should be aimed rather than newest
 * first.
 *
 * The monitor here is PLAN.md's example — a browser test runner — so a sample
 * of whatever Reddit posts happen to be newest is mostly other monitors' noise.
 * US-022 measured that a topical subreddit is where its matches are.
 */
const channel = args.find((arg) => arg.startsWith("--channel="))?.split("=")[1];

/**
 * Read the oldest stored posts rather than the newest.
 *
 * Each run creates its own monitor, so "unread by this monitor" is every post
 * every time and the newest slice is the same slice twice. The oldest slice of
 * a subreddit is US-022's collection, which is where the matches this product
 * has actually found are.
 */
const oldestFirst = args.includes("--oldest");

/** What the monitor may spend before both paid stages refuse. */
const capMicros = Number(args.find((arg) => arg.startsWith("--cap="))?.split("=")[1] ?? 100_000);

const logger = createLogger({ level: "warn", name: "live-notification" });
const { db, close } = createDatabase(databaseUrl);

const started = Date.now();
function say(line: string): void {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s] ${line}`);
}

let unscored: string | undefined;

/** A queue that runs the next step instead of enqueuing it. */
function inlineQueue(
  context: () => StepContext,
  filter: ReturnType<typeof createFilterStep>,
  classify: ReturnType<typeof createClassifyStep>,
) {
  const boss = {
    send: async (queue: string, payload: unknown) => {
      const { monitorId, postIds } = (payload ?? {}) as {
        monitorId?: string;
        postIds?: string[];
      };

      if (queue === filterQueue && monitorId && postIds) {
        say(`filter: ${postIds.length} stored posts into the pre-filter`);
        await filter({ monitorId, postIds }, context());
        return "inline";
      }

      if (queue === classifyQueue && monitorId && postIds) {
        say(`classify: ${postIds.length} posts survived it`);

        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          unscored = error instanceof Error ? error.message : String(error);
        }

        return "inline";
      }

      if (queue === notifyQueue) {
        // The worker would run the notify step here. This script runs it
        // itself, below, with the clock moved past the digest.
        say(`notify: the classifier reported ${postIds?.length ?? 0} new matches`);
        return "inline";
      }

      return "inline";
    },
  } as unknown as StepContext["boss"];

  return boss;
}

async function main(): Promise<void> {
  const notificationEnv = loadNotificationEnv(process.env);
  const readiness = notificationReadiness(notificationEnv);

  if (readiness.smtpMissing.length > 0) {
    console.error(
      `This deployment cannot send email: ${readiness.smtpMissing.join(", ")} not set. ` +
        "The run would create a monitor with email off and prove nothing.",
    );
    process.exit(1);
  }

  const owner = await ownerUserId(db);
  const [account] = await db.select().from(users).where(eq(users.id, owner));

  if (!account?.email) {
    console.error("The owning account has no email address, so there is nobody to send to.");
    process.exit(1);
  }

  say(`owner ${owner} — ${account.email}`);
  say(
    `mailer ${notificationEnv.SMTP_HOST}:${notificationEnv.SMTP_PORT} from ${notificationEnv.SMTP_FROM}`,
  );

  /**
   * The models this account pays with, resolved the way the worker resolves
   * them. `.env` holds no `AI_API_KEY` on this instance: the key is a row on
   * the account, which is US-068's whole point, so reading the environment
   * alone would find no classifier and score nothing.
   */
  const mine = await readAiEnvironment(db, owner, loadAiEnv(process.env));
  const aiConfig = aiConfigFromEnvironment(mine);

  if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
    console.error(
      `No model key for ${aiConfig.provider} on this account. Nothing would be scored.`,
    );
    process.exit(1);
  }

  const classifier = createClassifier({ config: aiConfig });
  const triager = createTriager({ config: triageConfigFromEnvironment(mine) });
  const embeddingConfig = embeddingConfigFromEnvironment(mine);
  const embedder =
    embeddingConfig && !(embeddingNeedsApiKey(embeddingConfig.provider) && !embeddingConfig.apiKey)
      ? createEmbedder({ config: embeddingConfig })
      : undefined;

  say(`model ${aiConfig.model}, triage ${triageConfigFromEnvironment(mine).model}`);

  const filter = createFilterStep({
    embedderFor: async () => embedder,
    triagerFor: async () => triager,
  });
  const classify = createClassifyStep({ classifierFor: async () => classifier });

  /**
   * The monitor, created through the same function the route calls.
   *
   * `notificationDefaults` is what US-093 added and it is the subject of this
   * run: the two inputs are the deployment's readiness and the owner's address,
   * exactly as `server.ts` and the create handler supply them.
   */
  const { monitor } = await createMonitor(
    db,
    {
      userId: owner,
      name: `US-093 live notification ${new Date().toISOString().slice(0, 16)}`,
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      signals: ["recommendation_request", "problem"],
      queries: {},
      subreddits: [],
      sources: [redditPlatformId],
      // US-022 measured this inside a topical subreddit: 30 lets "Dev memes"
      // through and 50 left nine matches that were all real.
      minScore: 50,
      // Paused, so the dev worker's scheduler never polls it. Nothing here
      // collects; a second poller would spend money nobody is watching.
      startPaused: true,
    },
    {
      descriptors: [],
      notificationDefaults: { canSendEmail: true, emailTo: account.email },
    },
  );

  const monitorId = monitor.id;

  await db.insert(budgets).values({ monitorId, monthlyCapMicros: capMicros, onExhausted: "pause" });

  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.monitorId, monitorId));

  if (!settings) {
    console.error("No notification settings row was written. That is US-093's whole claim.");
    process.exit(1);
  }

  say(`monitor ${monitorId}`);
  say(
    `settings: email ${settings.emailEnabled ? "on" : "off"} to ${settings.emailTo}, ` +
      `digest every ${settings.digestHours}h at ${settings.minScore}+, ` +
      `immediate above ${settings.immediateScore ?? "(none)"}, ` +
      `webhook ${settings.webhookEnabled ? "on" : "off"}`,
  );
  say(
    `enabled since ${settings.enabledSince.toISOString()}, next digest ${settings.nextDigestAt.toISOString()}`,
  );

  /**
   * Posts already stored, which this monitor has never paid to read.
   *
   * `NOT EXISTS` against `model_calls` rather than `NOT IN`, for the reason
   * `live-tiktok-comments.ts` records: an embedding is charged to the monitor
   * and to no post, so that column holds nulls and `NOT IN` would select
   * nothing.
   */
  const sample = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.source, redditPlatformId),
        eq(posts.kind, "post"),
        isNull(posts.deletedAt),
        ...(channel ? [eq(posts.channel, channel)] : []),
        sql`not exists (
          select 1 from ${modelCalls}
          where ${modelCalls.monitorId} = ${monitorId}
            and ${modelCalls.postId} = ${posts.id}
        )`,
      ),
    )
    .orderBy(oldestFirst ? asc(posts.postedAt) : desc(posts.postedAt))
    .limit(sampleSize);

  say(
    `reading ${sample.length} stored Reddit posts${channel ? ` from r/${channel}` : ""} — ` +
      "no provider is called",
  );

  const context = (): StepContext => ({ db, boss, logger });
  const boss = inlineQueue(context, filter, classify);

  await filter({ monitorId, postIds: sample.map((row) => row.id) }, { db, boss, logger });

  if (unscored) say(`classify did not finish everything: ${unscored}`);

  const found = await db
    .select({ id: matches.id, score: matches.score })
    .from(matches)
    .where(eq(matches.monitorId, monitorId))
    .orderBy(desc(matches.score));

  say(
    `matches: ${found.length}${found.length ? ` — scores ${found.map((m) => m.score).join(", ")}` : ""}`,
  );

  if (found.length === 0) {
    say("no match, so there is nothing to deliver. Try a larger sample.");
    return;
  }

  /**
   * The digest, delivered by the real transport.
   *
   * The clock is moved past `next_digest_at` and nothing else is changed. An
   * immediate alert needs no clock at all: a match above the threshold is due
   * the moment it is written.
   */
  const transport = createNotificationTransport(notificationEnv);
  const at = new Date(settings.nextDigestAt.getTime() + 60_000);

  say(`delivering as at ${at.toISOString()} — the moment the digest falls due`);

  await processNotifications(db, monitorId, transport, at, process.env.APP_URL);

  const deliveries = await db
    .select({
      id: notificationDeliveries.id,
      channel: notificationDeliveries.channel,
      kind: notificationDeliveries.kind,
      status: notificationDeliveries.status,
      attempts: notificationDeliveries.attempts,
      sentAt: notificationDeliveries.sentAt,
    })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.monitorId, monitorId));

  for (const delivery of deliveries) {
    const items = await db
      .select({ id: notificationItems.matchId })
      .from(notificationItems)
      .where(eq(notificationItems.deliveryId, delivery.id));

    say(
      `delivery ${delivery.channel}/${delivery.kind}: ${delivery.status}, ` +
        `${items.length} matches, ${delivery.attempts} attempt(s)` +
        (delivery.sentAt ? `, sent ${delivery.sentAt.toISOString()}` : ""),
    );
  }

  const [after] = await db
    .select({ error: notificationSettings.emailError })
    .from(notificationSettings)
    .where(eq(notificationSettings.monitorId, monitorId));

  say(after?.error ? `email error recorded: ${after.error}` : "no email error recorded");
  say(`check ${account.email}`);
}

try {
  await main();
} finally {
  await close();
}
