/**
 * Whether a plan that includes this instance's keys actually spends them, and
 * whether the cap actually stops it. US-128 and US-129.
 *
 * Both tickets closed their backend with the same gap: every claim is asserted
 * against our own half and none of it has met a provider. The suite proves the
 * rule, the four readers and the two worker seams. It cannot prove that a real
 * poll, through the real lookup, bills the account whose plan lends the keys —
 * and that is the claim the money rests on.
 *
 * **It is cheap on purpose.** One ScrapeCreators request for the account that
 * may spend, which is about $0.002, plus a model call for each post that
 * survives the pre-filter. Everything else here is a refusal, and a refusal
 * costs nothing: the account with no plan is turned away before a provider is
 * asked, and so is the account over its cap.
 *
 * **It runs on a scratch database and drops it.** The two accounts, their plans
 * and their monitors are the fixture, and none of them belongs in anybody's
 * development database.
 *
 *     pnpm --filter @signalscout/core live:lent-keys
 *     pnpm --filter @signalscout/core live:lent-keys --platform=tiktok
 */
import { eq } from "drizzle-orm";
import { createClassifier } from "../ai/classify.js";
import { aiConfigFromEnvironment, needsApiKey } from "../ai/config.js";
import { accountKeys } from "../billing/plan.js";
import { accountCapFrom, accountSpend } from "../budget/account.js";
import { loadAiEnv } from "../config/env.js";
import { createDatabase } from "../db/client.js";
import { apiUsage, modelCalls, monitors, posts, subscriptions, users } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createTestDatabase } from "../testing/database.js";
import { createClassifyStep } from "../worker/classify.js";
import { createCollectStep } from "../worker/collect.js";
import { createFilterStep } from "../worker/filter.js";
import { classifyQueue, filterQueue, notifyQueue, pollQueue } from "../worker/queues.js";
import { credentialsForAccounts } from "../worker/runtime.js";
import { enqueueDuePolls } from "../worker/schedule.js";
import type { StepContext } from "../worker/steps.js";
import { builtInSources } from "./index.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

/**
 * The platform to spend on. YouTube through ScrapeCreators is the cheapest
 * poll this repository has — 2 credits, about $0.004 — and the provider is the
 * one key a development machine is most likely to hold.
 */
const platformId =
  process.argv
    .filter((argument) => argument.startsWith("--platform="))
    .map((argument) => argument.slice("--platform=".length))[0] ?? "youtube";

/** One query, because each one is a billed request. */
const query =
  process.argv
    .filter((argument) => argument.startsWith("--query="))
    .map((argument) => argument.slice("--query=".length))[0] ?? "flaky end to end tests";

/**
 * The month to lend, for a run that wants to watch the model half cross it.
 *
 * The default is whatever the deployment lends, which is far more than one poll
 * spends — so the cap is proved by setting it to nothing in step 3 rather than
 * by reaching it. Pass a figure a little above the provider's own spend and the
 * classifier will cross it partway through the batch, which is the only way to
 * see the spend meter stop something.
 */
const capOverride = process.argv
  .filter((argument) => argument.startsWith("--cap-micros="))
  .map((argument) => Number(argument.slice("--cap-micros=".length)))[0];

const logger = createLogger({ level: "warn", name: "live-lent-keys" });

const started = Date.now();
const say = (line: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${line}`);

const money = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

/**
 * The model, built before anything is collected.
 *
 * A missing key stops the run rather than paying for posts nobody will read.
 * Spending the collection and then finding there is no classifier is the one
 * order that wastes the whole run.
 */
const aiConfig = aiConfigFromEnvironment(loadAiEnv(process.env));

if (needsApiKey(aiConfig.provider) && !aiConfig.apiKey) {
  console.error(`No model key for ${aiConfig.provider}. Set AI_API_KEY and run this again.`);
  process.exit(1);
}

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});

const scratch = await createTestDatabase("live_lent_keys");
const { db, close } = createDatabase(scratch.url);

say(`scratch database ${scratch.name}`);

/**
 * The deployment this run describes: registrations open, a plan on sale, and a
 * month to lend. Exactly the shape US-128 and US-129 were written for, and the
 * shape neither has ever run in.
 */
const capMicros = capOverride ?? accountCapFrom(process.env);
const keys = accountKeys(db, {
  signup: "open",
  mode: "stripe",
  environment: process.env,
  capMicros,
});

const credentialsFor = credentialsForAccounts(db, keys, logger);

async function account(id: string, plan: "own_keys" | "keys_included"): Promise<string> {
  await db.insert(users).values({ id, name: id, email: `${id}@example.test` });
  await db.insert(subscriptions).values({ userId: id, status: "active", plan });
  return id;
}

async function monitorFor(userId: string): Promise<string> {
  const [row] = await db
    .insert(monitors)
    .values({
      userId,
      name: `live ${platformId} poll for ${userId}`,
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      signals: ["recommendation_request", "problem"],
      sources: [platformId as never],
      generatedQueries: { [platformId]: [query] },
      generatedSubreddits: [],
      minScore: 50,
      // Paused, so the scheduler's own answer below is about the cap rather
      // than about a monitor that happened to be due.
      pausedAt: new Date(),
    })
    .returning({ id: monitors.id });

  if (!row) throw new Error("the monitor was not inserted");
  return row.id;
}

const classifier = createClassifier({ config: aiConfig });

const collect = createCollectStep({
  registry,
  credentialsFor,
  accountCapFor: (userId) => keys.cap(userId),
});
const filter = createFilterStep({ accountCapFor: (userId) => keys.cap(userId) });
const classify = createClassifyStep({
  classifierFor: async () => classifier,
  accountCapFor: (userId) => keys.cap(userId),
});

/** What the classify step complained about, if it could not finish. */
let unscored: string | undefined;

/** A queue that runs the next step instead of enqueuing it. `live-poll.ts`'s. */
function inlineQueue(context: () => StepContext) {
  return {
    send: async (queue: string, payload: unknown) => {
      if (queue === filterQueue) {
        const { monitorId, postIds } = payload as { monitorId: string; postIds: string[] };
        say(`  filter: ${postIds.length} collected posts`);
        await filter({ monitorId, postIds }, context());
      }

      if (queue === classifyQueue) {
        const { monitorId, postIds } = payload as { monitorId: string; postIds: string[] };
        say(`  classify: ${postIds.length} posts survived the pre-filter`);

        /**
         * The classify step throws when it could not score every post, so
         * pg-boss retries the ones it missed. That is right in the worker and
         * wrong here: the posts are already collected and already billed, and
         * dying now would throw away the three refusals this run exists to
         * measure — none of which costs anything to measure. `live-poll.ts`
         * catches it for the same reason.
         */
        try {
          await classify({ monitorId, postIds }, context());
        } catch (error) {
          unscored = error instanceof Error ? error.message : String(error);
          say(`  classify: ${unscored}`);
        }
      }

      if (queue === notifyQueue || queue === pollQueue) {
        say(`  ${queue}: not followed here`);
      }

      return "inline";
    },
  } as unknown as StepContext["boss"];
}

const context = (): StepContext => ({ db, boss: inlineQueue(context), logger });

async function spentBy(userId: string): Promise<number> {
  return (await accountSpend(db, userId)).totalMicros;
}

try {
  const included = await account("lent-keys-account", "keys_included");
  const own = await account("own-keys-account", "own_keys");

  say(
    `cap lent to a plan account: ${money(capMicros)} a month` +
      (capOverride === undefined ? "" : " (set for this run)"),
  );
  say(`keys the machine holds: ${credentialFieldsHeld().join(", ") || "(none)"}`);

  const includedMonitor = await monitorFor(included);
  const ownMonitor = await monitorFor(own);

  // 1. The account whose plan lends the keys. This is the half that spends.
  say("");
  say("1. the account whose plan includes the keys");
  await collect({ monitorId: includedMonitor }, context());
  say(`  spent: ${money(await spentBy(included))}`);

  const scored = await db.select().from(modelCalls).where(eq(modelCalls.userId, included));
  say(`  model calls recorded: ${scored.length}`);

  // 2. The account beside it, on the same instance, with no plan.
  say("");
  say("2. the account beside it, spending its own money");
  await collect({ monitorId: ownMonitor }, context());
  say(`  spent: ${money(await spentBy(own))}`);

  // 3. The cap. Nothing is lent, so the same poll is refused before a provider
  //    is asked — which is why this step costs nothing to prove.
  say("");
  say("3. the same account, with the month already spent");
  const spentKeys = accountKeys(db, {
    signup: "open",
    mode: "stripe",
    environment: process.env,
    capMicros: 0,
  });

  const spentCollect = createCollectStep({
    registry,
    credentialsFor: credentialsForAccounts(db, spentKeys, logger),
    accountCapFor: (userId) => spentKeys.cap(userId),
  });

  const before = await spentBy(included);
  await spentCollect({ monitorId: includedMonitor }, context());
  say(`  spent before: ${money(before)}, after: ${money(await spentBy(included))}`);

  // 4. The scheduler, which is the half that stops the work being started.
  say("");
  say("4. the scheduler, with the month already spent");
  /**
   * Unpaused *and* never polled, or the tick answers about the schedule rather
   * than about the cap. Both monitors polled a moment ago, so their own
   * interval would keep them out of the answer and the run would report a zero
   * that means nothing.
   */
  await db.update(monitors).set({ pausedAt: null, lastPolledAt: null });
  const tick = await enqueueDuePolls(db, fakeBoss(), logger, "stripe", 0);
  say(`  due: ${tick.due}, not sent for spending the month: ${tick.overCapSkipped}`);

  // What the ledgers say, which is the evidence rather than the log lines.
  say("");
  say("the ledgers");

  for (const [label, id] of [
    ["plan account", included],
    ["own-keys account", own],
  ] as const) {
    const usage = await db.select().from(apiUsage).where(eq(apiUsage.userId, id));
    const calls = await db.select().from(modelCalls).where(eq(modelCalls.userId, id));
    const stored = await db.select().from(posts);

    say(
      `  ${label}: ${usage.length} api_usage rows, ${calls.length} model_calls rows, ` +
        `${money(await spentBy(id))} total`,
    );

    for (const row of usage) {
      say(
        `    ${row.source} through ${row.provider}: ${row.units} units, ${money(row.estimatedCostMicros ?? 0)}`,
      );
    }

    if (label === "plan account") say(`    posts stored on the instance: ${stored.length}`);
  }

  if (unscored) {
    say("");
    say(`the model never answered: ${unscored}`);
    say("the provider half above still stands; the model half of the cap is unmeasured");
  }
} finally {
  await close();
  await scratch.drop();
  say(`dropped ${scratch.name}`);
}

/** Which provider keys this machine actually holds, for the line above. */
function credentialFieldsHeld(): string[] {
  return Object.keys(process.env)
    .filter((name) => /_API_KEY$|_API_TOKEN$/.test(name))
    .filter((name) => !name.startsWith("AI_"))
    .filter((name) => (process.env[name] ?? "").length > 0)
    .sort();
}

/** A queue that records nothing: this run is about who was skipped, not what ran. */
function fakeBoss() {
  return { send: async () => "queued" } as unknown as Parameters<typeof enqueueDuePolls>[1];
}
