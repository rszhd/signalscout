/**
 * US-026's live proof: change the provider while a collection is running.
 *
 * This is an instrument, not a test. The suite proves our half against the
 * fake connector; the claim underneath is about two real providers, and the
 * only way to ask them is to ask them. Run it when `collect.ts` changes how a
 * provider is chosen or resumed, and put the numbers in the ticket.
 *
 *     pnpm --filter @signalscout/core live:provider-switch
 *
 * **It spends money and it writes rows.** About $0.08 — one Bright Data
 * subreddit page at $0.075, one ScrapeCreators search at $0.00376 — and it
 * leaves behind a paused monitor and two `api_usage` rows, which are the
 * evidence. It needs both providers' keys and it needs `DATABASE_URL`.
 *
 * It drives `createCollectStep` directly with a stubbed queue, so nothing is
 * filtered or classified and no model is called. The only spend is the two
 * providers.
 *
 * What it is trying to see, in order:
 *
 *   1. Bright Data starts a collection and hands back a cursor, which becomes
 *      a row in `source_continuations` carrying the provider.
 *   2. The choice moves to ScrapeCreators while that snapshot is still
 *      collecting.
 *   3. Every resume still goes to Bright Data, with Bright Data's own cursor.
 *      A resume through ScrapeCreators would read a snapshot id it has never
 *      heard of, and would pay for the query a second time.
 *   4. Once that collection closes, the next one goes to ScrapeCreators.
 *   5. `api_usage` holds two rows, each priced by the connector that ran.
 */
import { desc, eq } from "drizzle-orm";
import { ownerUserId } from "../auth/user.js";
import { createDatabase } from "../db/client.js";
import { apiUsage, monitors, posts, sourceContinuations, sourceProviders } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { createCollectStep } from "../worker/collect.js";
import { credentialsFromStore } from "../worker/credentials.js";
import type { StepContext } from "../worker/steps.js";
import { setProviderChoice } from "./choices.js";
import { builtInSources } from "./index.js";
import { createSourceRegistry } from "./registry.js";
import { createSourceRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL. Start Postgres with `pnpm db:up` and check .env.");
  process.exit(1);
}

const logger = createLogger({ level: "info", name: "live-switch" });
const { db, close } = createDatabase(databaseUrl);

const registry = createSourceRegistry({
  definitions: builtInSources,
  runtime: createSourceRuntime({ logger }),
});

/** The one account this instance has, or the pre-account id. US-067. */
const owner = await ownerUserId(db);
const credentialsFor = credentialsFromStore(db, undefined, process.env, logger);

/** A queue that swallows everything. Nothing here is meant to be classified. */
const boss = { send: async () => "not-queued" } as unknown as StepContext["boss"];
const collect = createCollectStep({ registry, credentialsFor });

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

function say(line: string): void {
  console.log(`[${since().padStart(7)}] ${line}`);
}

async function usage(monitorId: string) {
  return db
    .select({
      provider: apiUsage.provider,
      units: apiUsage.units,
      micros: apiUsage.estimatedCostMicros,
      at: apiUsage.updatedAt,
    })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId));
}

async function continuation(monitorId: string) {
  const [row] = await db
    .select()
    .from(sourceContinuations)
    .where(eq(sourceContinuations.monitorId, monitorId))
    .limit(1);

  return row;
}

/**
 * Every Reddit post in the database.
 *
 * The whole table, because a post belongs to no monitor. What matters is how
 * the count moves across one collection: a subreddit both providers have
 * already collected adds nothing, and that is deduplication holding.
 */
async function storedPosts(): Promise<number> {
  const rows = await db.select({ id: posts.id }).from(posts).where(eq(posts.source, "reddit"));

  return rows.length;
}

async function main(): Promise<void> {
  // Paused, so the dev worker's scheduler never picks it up. This script polls
  // it by hand; a second poller would spend money nobody is watching.
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: owner,
      name: "US-026 live provider switch",
      product: "A test runner that records browser flows instead of coding them",
      idealCustomer: "Small SaaS teams with no dedicated QA engineer",
      problem: "End-to-end tests break whenever the UI changes",
      sources: ["reddit"],
      generatedQueries: [],
      // One subreddit, which is the discovery mode US-022 measured at $0.075
      // for fifty records. A keyword would cost the same and return noise.
      generatedSubreddits: ["softwaretesting"],
      pausedAt: new Date(),
    })
    .returning();

  if (!monitor) throw new Error("The monitor was not created.");

  // Before anything is spent. A key missing here would otherwise be found
  // after Bright Data had already been paid for a snapshot.
  for (const connector of registry.forPlatform("reddit")) {
    if (!(await credentialsFor(connector, owner))) {
      throw new Error(`No credentials for ${connector.provider.id}. Both keys are needed here.`);
    }
  }

  const monitorId = monitor.id;
  const before = await storedPosts();

  say(`monitor ${monitorId}, r/softwaretesting, ${before} Reddit posts already stored`);

  const context: StepContext = { db, boss, logger };

  // 1. Bright Data starts the collection.
  await setProviderChoice(db, "reddit", "brightdata");
  say("choice: brightdata");

  await collect({ monitorId }, context);

  const opened = await continuation(monitorId);

  say(
    opened
      ? `collection open: provider=${opened.provider} cursor=${opened.cursor} resumeAfter=${opened.resumeAfter.toISOString()}`
      : "no collection was left open — Bright Data answered in one call",
  );
  say(`spent so far: ${JSON.stringify(await usage(monitorId))}`);

  // 2. The switch, while the snapshot is still collecting.
  await setProviderChoice(db, "reddit", "scrapecreators");
  say("choice: scrapecreators — changed while the Bright Data snapshot is open");

  // 3. Resume until the snapshot is read, or until it is clearly stuck.
  const deadline = Date.now() + 20 * 60 * 1000;
  let resumes = 0;

  while ((await continuation(monitorId)) && Date.now() < deadline) {
    const open = await continuation(monitorId);
    if (!open) break;

    const waitMs = Math.max(0, open.resumeAfter.getTime() - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 30_000)));
    if (open.resumeAfter.getTime() > Date.now()) continue;

    resumes += 1;
    await collect({ monitorId }, context);

    const after = await continuation(monitorId);
    say(
      after
        ? `resume ${resumes}: still collecting, provider=${after.provider} cursor=${after.cursor} attempts=${after.attempts}`
        : `resume ${resumes}: the collection is read and closed`,
    );
  }

  const afterBrightData = await storedPosts();
  say(`posts after the Bright Data collection: ${afterBrightData} (was ${before})`);
  say(`spent so far: ${JSON.stringify(await usage(monitorId))}`);

  // 4. The next collection. No continuation, so the recorded choice decides,
  //    and it now names ScrapeCreators.
  await db.update(monitors).set({ lastPolledAt: null }).where(eq(monitors.id, monitorId));
  say("poll mark cleared, so the next collection asks for the same window");

  await collect({ monitorId }, context);

  const afterSwitch = await storedPosts();

  say(`posts after the ScrapeCreators collection: ${afterSwitch}`);
  say(`spent in total: ${JSON.stringify(await usage(monitorId))}`);

  const providers = await db
    .select({ provider: apiUsage.provider })
    .from(apiUsage)
    .where(eq(apiUsage.monitorId, monitorId))
    .orderBy(desc(apiUsage.updatedAt));

  say(`providers billed, newest first: ${providers.map((row) => row.provider).join(", ")}`);
  say(`recorded choice now: ${JSON.stringify(await db.select().from(sourceProviders))}`);
  say(`resumes taken: ${resumes}`);
}

try {
  await main();
} finally {
  await close();
}
