/** Correctness-critical: deleted content remains visible, or an outage empties the inbox.
 * Assertions precede implementation. Fake answers describe our contract, not a provider payload.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recordSourceUsage, setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import {
  apiUsage,
  feedback,
  matches,
  monitors,
  posts,
  postVerifications,
  sourceContinuations,
  sourceProviders,
} from "../db/schema.js";
import { exportFeedback } from "../feedback/feedback.js";
import { listMatches } from "../matches/matches.js";
import type { VerificationResult } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createReconcileStep } from "./reconcile.js";
import type { StepContext } from "./steps.js";
import {
  fakeRegistry,
  insertMonitor,
  silentLogger,
  twoProviderRegistry,
  until,
} from "./testing.js";

const now = new Date("2026-09-05T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3600000);
let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;
let monitorId: string;
const verify = vi.fn<(...args: unknown[]) => Promise<VerificationResult>>();
let context: StepContext;
let run: ReturnType<typeof createReconcileStep>;
beforeAll(async () => {
  database = await createTestDatabase("reconcile");
  ({ db, close } = createDatabase(database.url));
  context = {
    db,
    logger: silentLogger,
    boss: { findJobs: vi.fn().mockResolvedValue([]) } as unknown as StepContext["boss"],
  };
}, 60000);
afterAll(async () => {
  await close?.();
  await database?.drop();
});
beforeEach(async () => {
  await db.delete(monitors);
  await db.delete(posts);
  monitorId = await insertMonitor(database, { pausedAt: ago(1), lastPolledAt: now });
  vi.mocked(context.boss.findJobs).mockResolvedValue([]);
  verify.mockReset();
  verify.mockResolvedValue({ status: "available", unitsConsumed: 1 });
  const registry = fakeRegistry({ pricePerUnitMicros: 1500 });
  const source = registry.get("reddit", "brightdata");
  source.verify = verify;
  run = createReconcileStep({
    registry,
    credentialsFor: async () => ({ token: "test" }),
    now: () => now,
  });
});
async function seed(
  options: {
    age?: number;
    verified?: number;
    read?: boolean;
    postId?: string;
    monitor?: string;
  } = {},
) {
  const postId = options.postId ?? randomUUID();
  if (!options.postId)
    await db.insert(posts).values({
      id: postId,
      source: "reddit",
      provider: "brightdata",
      externalId: `t3_${postId}`,
      url: "https://www.reddit.com/comments/abc/",
      title: "A request for help",
      excerpt: "A short excerpt",
      postedAt: ago(options.age ?? 1),
    });
  const [match] = await db
    .insert(matches)
    .values({
      monitorId: options.monitor ?? monitorId,
      postId,
      score: 80,
      relevance: 80,
      problemFit: 80,
      icpFit: 80,
      intent: 80,
      urgency: 80,
      intentType: "problem",
      reasons: ["A buyer asks for help"],
      lastVerifiedAt: ago(options.verified ?? 48),
      readAt: options.read ? ago(1) : null,
    })
    .returning();
  if (!match) throw new Error("No match");
  return match;
}
it("hides every match for a deleted post and preserves verdicts and scores", async () => {
  const first = await seed();
  const other = await insertMonitor(database);
  await seed({ postId: first.postId, monitor: other });
  await db.insert(feedback).values({
    monitorId,
    matchId: first.id,
    userId: "self-hosted",
    verdict: "good",
    monitorVersion: 1,
  });
  verify.mockResolvedValue({ status: "deleted", unitsConsumed: 1 });
  await run({}, context);
  expect(verify).toHaveBeenCalledTimes(1);
  const rows = await db.select().from(matches);
  expect(rows.every((row) => row.hidden && row.lastVerifiedAt.getTime() === now.getTime())).toBe(
    true,
  );
  expect(rows.map((row) => row.score)).toEqual([80, 80]);
  expect(rows[0]?.reasons).toEqual(["A buyer asks for help"]);
  expect(await db.select().from(feedback)).toHaveLength(1);
  expect(await exportFeedback(db)).toMatchObject([{ score: 80, verdict: "good", title: null }]);
  expect((await listMatches(db, { includeNotRelevant: true })).matches).toEqual([]);
  expect((await db.select().from(posts))[0]?.deletedAt).toEqual(now);
});
it("checks oldest verification first and advances a successful check", async () => {
  const newer = await seed({ verified: 25 });
  const older = await seed({ verified: 49 });
  await run({}, context);
  expect(verify.mock.calls.map((call) => (call[0] as { externalId: string }).externalId)).toEqual([
    `t3_${older.postId}`,
    `t3_${newer.postId}`,
  ]);
  expect(
    (await db.select().from(matches)).every(
      (row) => row.lastVerifiedAt.getTime() === now.getTime() && !row.hidden,
    ),
  ).toBe(true);
});
it("checks recent unread posts daily, recent read posts every three days, old unread weekly and old read monthly", async () => {
  await seed({ age: 1, verified: 23 });
  await seed({ age: 1, verified: 25 });
  await seed({ age: 1, verified: 71, read: true });
  await seed({ age: 1, verified: 73, read: true });
  await seed({ age: 200, verified: 167 });
  await seed({ age: 200, verified: 169 });
  await seed({ age: 200, verified: 719, read: true });
  await seed({ age: 200, verified: 721, read: true });
  await run({}, context);
  expect(verify).toHaveBeenCalledTimes(4);
});
it.each(["throw", "unknown"] as const)(
  "leaves content visible on %s and backs off without claiming verification",
  async (failure) => {
    const match = await seed();
    if (failure === "throw") verify.mockRejectedValue(new Error("unreachable"));
    else verify.mockResolvedValue({ status: "unknown", unitsConsumed: 1 });
    await run({}, context);
    await run({}, context);
    expect(verify).toHaveBeenCalledTimes(1);
    expect((await db.select().from(matches))[0]).toMatchObject({
      hidden: false,
      lastVerifiedAt: match.lastVerifiedAt,
    });
    expect((await db.select().from(postVerifications))[0]?.nextAttemptAt).toEqual(ago(-24));
  },
);
it("refuses a metered re-check at the cap before reaching the provider", async () => {
  await seed();
  await setBudget(db, monitorId, { monthlyCapMicros: 1500, onExhausted: "notify" });
  await recordSourceUsage(db, {
    monitorId,
    source: "reddit",
    provider: "brightdata",
    units: 1,
    pricePerUnitMicros: 1500,
    now,
  });
  await run({}, context);
  expect(verify).not.toHaveBeenCalled();
});
it("records each billed check and stops at the cap within a batch", async () => {
  await seed();
  await seed();
  await setBudget(db, monitorId, { monthlyCapMicros: 1500, onExhausted: "notify" });
  await run({}, context);
  expect(verify).toHaveBeenCalledTimes(1);
});
it("defers to a due poll", async () => {
  await seed();
  await db
    .update(monitors)
    .set({ pausedAt: null, lastPolledAt: ago(2) })
    .where(eq(monitors.id, monitorId));
  await run({}, context);
  expect(verify).not.toHaveBeenCalled();
});
it("persists a pending check and resumes its cursor without triggering again", async () => {
  await seed();
  verify.mockResolvedValue({
    status: "pending",
    cursor: "snapshot-1",
    retryAfter: ago(-1),
    unitsConsumed: 0,
  });
  await run({}, context);
  await run({}, context);
  expect(verify).toHaveBeenCalledTimes(1);
  await db.update(postVerifications).set({ nextAttemptAt: ago(1) });
  verify.mockResolvedValue({ status: "deleted", unitsConsumed: 1 });
  await run({}, context);
  expect(verify.mock.calls[1]?.[0]).toMatchObject({ cursor: "snapshot-1" });
  expect((await db.select().from(matches))[0]?.hidden).toBe(true);
});
it("a late classification cannot resurrect a deleted post in another monitor", async () => {
  const original = await seed();
  verify.mockResolvedValue({ status: "deleted", unitsConsumed: 1 });
  await run({}, context);
  const other = await insertMonitor(database);
  const late = await seed({ postId: original.postId, monitor: other });
  expect(late.hidden).toBe(true);
  await db.update(matches).set({ hidden: false }).where(eq(matches.id, late.id));
  expect((await db.select().from(matches).where(eq(matches.id, late.id)))[0]?.hidden).toBe(true);
});

it("a restart and provider switch preserve the provider that started a check", async () => {
  await seed();
  verify.mockResolvedValue({
    status: "pending",
    cursor: "original-snapshot",
    retryAfter: ago(-1),
    unitsConsumed: 0,
  });
  await run({}, context);
  await db.update(postVerifications).set({ nextAttemptAt: ago(1) });
  await db
    .insert(sourceProviders)
    .values({ source: "reddit", provider: "scrapecreators" })
    .onConflictDoUpdate({ target: sourceProviders.source, set: { provider: "scrapecreators" } });
  const registry = twoProviderRegistry();
  const other = vi.fn();
  registry.get("reddit", "brightdata").verify = verify;
  registry.get("reddit", "scrapecreators").verify = other;
  verify.mockResolvedValue({ status: "available", unitsConsumed: 1 });
  await createReconcileStep({
    registry,
    credentialsFor: async () => ({ token: "test" }),
    now: () => now,
  })({}, context);
  expect(other).not.toHaveBeenCalled();
  expect(verify.mock.calls[1]?.[0]).toMatchObject({ cursor: "original-snapshot" });
  expect((await db.select().from(apiUsage)).every((row) => row.provider === "brightdata")).toBe(
    true,
  );
  await db.delete(sourceProviders);
});
it("the production scheduler drives a real deletion check through pg-boss", async () => {
  const { startWorker } = await import("./runtime.js");
  const { scheduleTickQueue } = await import("./queues.js");
  const match = await seed();
  const registry = fakeRegistry();
  registry.get("reddit", "brightdata").verify = verify;
  verify.mockResolvedValue({ status: "deleted", unitsConsumed: 0 });
  const worker = await startWorker({
    databaseUrl: database.url,
    registry,
    credentialsFor: () => ({ token: "test" }),
    logger: silentLogger,
    scheduleTicks: false,
  });
  try {
    await worker.boss.send(scheduleTickQueue, {});
    await until("scheduler to hide the removed post", async () => {
      const [row] = await db.select().from(matches).where(eq(matches.id, match.id));
      return row?.hidden ? true : undefined;
    });
    expect(verify).toHaveBeenCalledTimes(1);
  } finally {
    await worker.stop();
  }
}, 30000);

it("defers a new metered check while a poll is already active", async () => {
  await seed();
  vi.mocked(context.boss.findJobs).mockResolvedValue([
    { state: "active", startAfter: now },
  ] as Awaited<ReturnType<StepContext["boss"]["findJobs"]>>);
  await run({}, context);
  expect(verify).not.toHaveBeenCalled();
});

it("defers new checks while a poll waits on an already-triggered snapshot", async () => {
  await seed();
  await db.insert(sourceContinuations).values({
    monitorId,
    source: "reddit",
    provider: "brightdata",
    cursor: "paid-poll-snapshot",
    resumeAfter: ago(-1),
  });
  await run({}, context);
  expect(verify).not.toHaveBeenCalled();
});
