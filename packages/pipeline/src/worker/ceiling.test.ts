/**
 * The per-pair ceiling, without a worker. US-287.
 *
 * Correctness-critical: the bound the hosted product's allowance rests on.
 * The cases are the rule's own sentences: a pair has room until it has put
 * the day's number to the classifier; a post found by two pairs counts
 * against both and is admitted while either has room; a reply is its
 * parent's; yesterday is not today; a post no pair found is admitted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { modelCalls, monitors, postDiscoveries, posts } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { loadCeiling, startOfUtcDay } from "./ceiling.js";
import { insertMonitor } from "./testing.js";

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

const now = new Date("2026-09-21T10:00:00Z");
const yesterday = new Date("2026-09-20T23:30:00Z");

beforeAll(async () => {
  database = await createTestDatabase("worker_ceiling");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close();
  await database.drop();
});

afterEach(async () => {
  await db.delete(modelCalls);
  await db.delete(postDiscoveries);
  await db.delete(posts);
  await db.delete(monitors);
});

let serial = 0;

async function post(kind: "post" | "reply" = "post", parentPostId?: string): Promise<string> {
  serial += 1;
  const [row] = await db
    .insert(posts)
    .values({
      source: "reddit",
      externalId: `p-${serial}`,
      url: `https://www.reddit.com/r/SaaS/comments/${serial}/`,
      excerpt: "Our end to end tests break on every UI change.",
      postedAt: now,
      kind,
      ...(parentPostId ? { parentPostId } : {}),
    })
    .returning({ id: posts.id });
  if (!row) throw new Error("no post");
  return row.id;
}

async function found(
  monitorId: string,
  postId: string,
  value: string,
  kind: "query" | "channel" = "query",
) {
  await db
    .insert(postDiscoveries)
    .values({ monitorId, postId, source: "reddit", kind, value })
    .onConflictDoNothing();
}

async function classified(monitorId: string, postId: string, at: Date) {
  await db.insert(modelCalls).values({
    monitorId,
    postId,
    userId: "user-1",
    provider: "openai",
    model: "test-model",
    purpose: "classification",
    outcome: "scored",
    monitorVersion: 1,
    latencyMs: 1,
    estimatedCostMicros: 250,
    createdAt: at,
  });
}

describe("the day's ceiling on a pair", () => {
  it("admits a pair's posts until the day's number, then refuses the rest", async () => {
    const monitorId = await insertMonitor(database);
    const ids = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await post();
      await found(monitorId, id, "flaky tests");
      ids.push(id);
    }

    const ceiling = await loadCeiling(db, monitorId, ids, 3, now);

    // Three in, and the tally moves inside the batch: the fourth is refused
    // in the same job that admitted the first.
    for (const id of ids.slice(0, 3)) {
      expect(ceiling.hasRoom(id)).toBe(true);
      ceiling.charge(id);
    }
    expect(ceiling.hasRoom(ids[3] as string)).toBe(false);
  });

  it("counts what the ledger says the pair put to the classifier today", async () => {
    const monitorId = await insertMonitor(database);
    const earlier = [await post(), await post()];
    for (const id of earlier) {
      await found(monitorId, id, "flaky tests");
      await classified(monitorId, id, new Date("2026-09-21T02:00:00Z"));
    }
    const next = await post();
    await found(monitorId, next, "flaky tests");

    // Two used of three: one more fits, and then none.
    const ceiling = await loadCeiling(db, monitorId, [next], 3, now);
    expect(ceiling.usedBy(next)).toBe(2);
    expect(ceiling.hasRoom(next)).toBe(true);
    ceiling.charge(next);
    expect(ceiling.hasRoom(next)).toBe(false);

    // At the number already, refused at the door.
    expect((await loadCeiling(db, monitorId, [next], 2, now)).hasRoom(next)).toBe(false);
  });

  it("starts the count again at the UTC midnight", async () => {
    const monitorId = await insertMonitor(database);
    const late = [await post(), await post(), await post()];
    for (const id of late) {
      await found(monitorId, id, "flaky tests");
      await classified(monitorId, id, yesterday);
    }
    const today = await post();
    await found(monitorId, today, "flaky tests");

    expect((await loadCeiling(db, monitorId, [today], 3, now)).usedBy(today)).toBe(0);
    expect((await loadCeiling(db, monitorId, [today], 3, now)).hasRoom(today)).toBe(true);
    // And the same rows, read before midnight, are the day's.
    expect((await loadCeiling(db, monitorId, [today], 3, yesterday)).hasRoom(today)).toBe(false);
    expect(startOfUtcDay(yesterday).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("counts a post found by two pairs against both, and admits it while either has room", async () => {
    const monitorId = await insertMonitor(database);
    const full = [await post(), await post()];
    for (const id of full) {
      await found(monitorId, id, "flaky tests");
      await classified(monitorId, id, now);
    }
    const both = await post();
    await found(monitorId, both, "flaky tests");
    await found(monitorId, both, "manual testing");
    const onlyFull = await post();
    await found(monitorId, onlyFull, "flaky tests");

    const ceiling = await loadCeiling(db, monitorId, [both, onlyFull], 2, now);

    // "flaky tests" is full; "manual testing" has room, so the post found by
    // both is admitted — and charged to both.
    expect(ceiling.hasRoom(onlyFull)).toBe(false);
    expect(ceiling.hasRoom(both)).toBe(true);
    ceiling.charge(both);
    expect(ceiling.usedBy(both)).toBe(3);

    // A second post on "manual testing" alone now finds it at one of two.
    const second = await post();
    await found(monitorId, second, "manual testing");
    const again = await loadCeiling(db, monitorId, [second], 2, now);
    expect(again.hasRoom(second)).toBe(true);
  });

  it("gives a reply its parent's pairs, and counts a classified reply against them", async () => {
    const monitorId = await insertMonitor(database);
    const parent = await post();
    await found(monitorId, parent, "flaky tests");
    const replies = [await post("reply", parent), await post("reply", parent)];
    await classified(monitorId, replies[0] as string, now);

    const ceiling = await loadCeiling(db, monitorId, [replies[1] as string], 2, now);
    // One reply classified today counts as one of the pair's two.
    expect(ceiling.usedBy(replies[1] as string)).toBe(1);
    expect(ceiling.hasRoom(replies[1] as string)).toBe(true);
    ceiling.charge(replies[1] as string);
    expect(ceiling.hasRoom(replies[1] as string)).toBe(false);
    // And so is the parent itself.
    expect((await loadCeiling(db, monitorId, [parent], 1, now)).hasRoom(parent)).toBe(false);
  });

  it("treats a channel as a pair of its own", async () => {
    const monitorId = await insertMonitor(database);
    const first = await post();
    await found(monitorId, first, "r/SaaS", "channel");
    await classified(monitorId, first, now);
    const second = await post();
    await found(monitorId, second, "r/SaaS", "channel");

    expect((await loadCeiling(db, monitorId, [second], 1, now)).hasRoom(second)).toBe(false);
    expect((await loadCeiling(db, monitorId, [second], 2, now)).hasRoom(second)).toBe(true);
  });

  it("admits a post no pair can be found for", async () => {
    const monitorId = await insertMonitor(database);
    const orphan = await post();

    const ceiling = await loadCeiling(db, monitorId, [orphan], 1, now);
    expect(ceiling.hasRoom(orphan)).toBe(true);
    ceiling.charge(orphan);
    expect(ceiling.hasRoom(orphan)).toBe(true);
  });

  it("keeps one monitor's day apart from another's", async () => {
    const mine = await insertMonitor(database);
    const theirs = await insertMonitor(database, { name: "Theirs" });
    const shared = await post();
    await found(mine, shared, "flaky tests");
    await found(theirs, shared, "flaky tests");
    await classified(theirs, shared, now);

    expect((await loadCeiling(db, mine, [shared], 1, now)).hasRoom(shared)).toBe(true);
    expect((await loadCeiling(db, theirs, [shared], 1, now)).hasRoom(shared)).toBe(false);
  });
});
