import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, maxResumeAttempts, monitors, posts, sourceContinuations } from "../db/schema.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import type { CandidatePost, SearchRequest, SocialSource } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createCollectStep, excerptLength, maxPagesPerPoll } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import { filterQueue, pollQueue } from "./queues.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

/**
 * The poll step, driven without a queue.
 *
 * The source is the fake connector, whose runtime is given a `fetch` that
 * cannot reach anything, so "this test spends no money" is a property of the
 * setup and not a claim about the code.
 */
const credentials: CredentialLookup = () => ({ token: "test-token" });

function stubBoss() {
  return {
    send: vi.fn(async (_queue: string, _payload: unknown, _options?: unknown) => "job-1"),
  };
}

/** What the step handed to a queue, or a failure that says which queue was silent. */
function sentTo(boss: ReturnType<typeof stubBoss>, queue: string): { postIds: string[] } {
  const call = boss.send.mock.calls.find(([name]) => name === queue);

  if (!call) throw new Error(`Nothing was sent to the ${queue} queue.`);

  return call[1] as { postIds: string[] };
}

/** The poll job the step booked for itself, or a failure saying none was. */
function pollSend(boss: ReturnType<typeof stubBoss>): [string, unknown, { startAfter?: Date }] {
  const call = boss.send.mock.calls.find(([name]) => name === pollQueue);

  if (!call) throw new Error("No poll job was booked.");

  return call as unknown as [string, unknown, { startAfter?: Date }];
}

function contextFor(db: Database, boss: ReturnType<typeof stubBoss>): StepContext {
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

/** Every search the fake served, in order. An empty list means it was never asked. */
function callsOf(registry: ReturnType<typeof fakeRegistry>): readonly SearchRequest[] {
  return (registry.get("reddit") as SocialSource & { calls: readonly SearchRequest[] }).calls;
}

describe("the poll step", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_collect");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(posts);
    await db.delete(monitors);
  });

  it("stores what the source returned and hands the ids to the filter step", async () => {
    const monitorId = await insertMonitor(database);
    const boss = stubBoss();
    const registry = fakeRegistry();

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, boss),
    );

    const stored = await db.select().from(posts);

    expect(stored).toHaveLength(fakePosts.length);
    expect(stored.map((post) => post.externalId).sort()).toEqual(
      fakePosts.map((post) => post.externalId).sort(),
    );
    expect(stored.every((post) => post.source === "reddit")).toBe(true);

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(sentTo(boss, filterQueue).postIds).toHaveLength(fakePosts.length);
  });

  it("pages until the source says it is done, and never on the page length", async () => {
    // Two posts a page, five posts. A caller that stopped when a page came
    // back shorter than the last would keep two of the five.
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({ pageSize: 2 });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
  });

  it("stops at the page cap rather than spending without a limit", async () => {
    const many: CandidatePost[] = Array.from({ length: 40 }, (_, index) => ({
      externalId: `bulk-${index}`,
      url: `https://example.test/bulk/${index}`,
      text: `Post number ${index}`,
      postedAt: new Date("2026-08-10T09:00:00.000Z"),
    }));

    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({ posts: many, pageSize: 1 });
    const source = registry.get("reddit") as SocialSource & { calls: readonly unknown[] };

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    // The cap, not the forty posts behind it. US-013's budget cap limits what
    // a monitor spends in a month; this limits how far one poll can carry it
    // past that, which is the part a monthly cap cannot do on its own.
    expect(source.calls).toHaveLength(maxPagesPerPoll);
    expect(await db.select().from(posts)).toHaveLength(maxPagesPerPoll);
  });

  it("stops when the source asks to be called back later", async () => {
    const monitorId = await insertMonitor(database);
    // One search, then the allowance is gone and the connector reports a wait.
    const registry = fakeRegistry({ pageSize: 1, callsBeforeRateLimit: 1 });
    const source = registry.get("reddit") as SocialSource & { calls: readonly unknown[] };

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    // Two calls: the one that was served, and the one that was told to wait.
    // Holding the job open for the window would block a worker slot and, on a
    // long window, expire the job.
    expect(source.calls).toHaveLength(2);
    expect(await db.select().from(posts)).toHaveLength(1);
  });

  it("skips a source with no credentials instead of failing the job", async () => {
    // A missing key is not transient. Failing here would retry four times and
    // then bury the one sentence the user has to read in a dead letter queue.
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const source = registry.get("reddit") as SocialSource & { calls: readonly unknown[] };
    const boss = stubBoss();

    await expect(
      createCollectStep({ registry, credentialsFor: () => undefined })(
        { monitorId },
        contextFor(db, boss),
      ),
    ).resolves.toBeUndefined();

    expect(source.calls).toHaveLength(0);
    expect(boss.send).not.toHaveBeenCalled();
    expect(await db.select().from(posts)).toHaveLength(0);
  });

  it("moves the poll mark forward and asks the next poll only for what is newer", async () => {
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const source = registry.get("reddit") as SocialSource & {
      calls: readonly { query: { since?: Date } }[];
    };
    const collect = createCollectStep({ registry, credentialsFor: credentials });

    await collect({ monitorId }, contextFor(db, stubBoss()));

    const [afterFirst] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

    expect(source.calls[0]?.query.since).toBeUndefined();
    expect(afterFirst?.lastPolledAt).not.toBeNull();

    await collect({ monitorId }, contextFor(db, stubBoss()));

    // The second poll asks from where the first one got to. Without this every
    // poll re-reads the whole window, and on X every re-read is billed.
    expect(source.calls[1]?.query.since?.getTime()).toBe(afterFirst?.lastPolledAt?.getTime());
  });

  it("stores a post once, and still gives its id to a second monitor", async () => {
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second monitor" });
    const registry = fakeRegistry();
    const collect = createCollectStep({ registry, credentialsFor: credentials });

    const firstBoss = stubBoss();
    const secondBoss = stubBoss();

    await collect({ monitorId: first }, contextFor(db, firstBoss));
    await collect({ monitorId: second }, contextFor(db, secondBoss));

    // One row per post, however many monitors saw it. The unique constraint is
    // the last defence when the cursor logic fails.
    expect(await db.select().from(posts)).toHaveLength(fakePosts.length);

    // And the second monitor still gets every id. Returning only the newly
    // inserted rows would drop a post out of the second monitor's pipeline
    // for good, because it was already stored by the first.
    expect(sentTo(secondBoss, filterQueue).postIds).toHaveLength(fakePosts.length);
  });

  it("keeps an excerpt, not the whole post", async () => {
    // Reddit's terms require that content the author removed stops being
    // shown. The less we hold, the less there is to remove.
    const long = "x".repeat(excerptLength + 500);
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({
      posts: [
        {
          externalId: "long-1",
          url: "https://example.test/long/1",
          text: long,
          postedAt: new Date("2026-08-10T09:00:00.000Z"),
        },
      ],
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const [stored] = await db.select().from(posts);

    expect(stored?.excerpt).toHaveLength(excerptLength);
  });

  it("does nothing when the monitor was deleted between the tick and the job", async () => {
    const boss = stubBoss();

    await expect(
      createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId: "00000000-0000-0000-0000-000000000000" },
        contextFor(db, boss),
      ),
    ).resolves.toBeUndefined();

    expect(boss.send).not.toHaveBeenCalled();
  });

  /**
   * Correctness-critical: cursor and deduplication. Written before the fix.
   *
   * BUG-001. A Bright Data collection is asynchronous: the trigger answers
   * with a wait and a cursor, and the records exist only inside the snapshot
   * that cursor names. A poll that drops the cursor pays for a collection
   * nobody reads, and the next poll pays again for the same query. The first
   * live run did exactly that.
   *
   * The fake reports a wait the same way a metered source does, so these drive
   * the caller's half without a network and without a bill.
   */
  describe("a collection the source asked us to come back for", () => {
    function continuationsFor(monitorId: string) {
      return db
        .select()
        .from(sourceContinuations)
        .where(eq(sourceContinuations.monitorId, monitorId));
    }

    /** Serves one post of the five, then reports a wait carrying its cursor. */
    function waitingRegistry() {
      return fakeRegistry({ pageSize: 1, callsBeforeRateLimit: 1 });
    }

    /**
     * The provider's wait, over.
     *
     * Moving the stored deadline is how this file says time passed. Sleeping
     * out the fake's real window would hold the suite for a minute and would
     * be a race rather than an ordering: docs/testing.md, *A wait in
     * milliseconds is a race*.
     */
    async function theWaitIsOver(monitorId: string) {
      await db
        .update(sourceContinuations)
        .set({ resumeAfter: new Date(Date.now() - 1000) })
        .where(eq(sourceContinuations.monitorId, monitorId));
    }

    async function poll(
      registry: ReturnType<typeof fakeRegistry>,
      monitorId: string,
      boss = stubBoss(),
    ) {
      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, boss),
      );
      return boss;
    }

    it("keeps the cursor the source issued, and books the resume for when it said", async () => {
      const monitorId = await insertMonitor(database);
      const before = Date.now();

      const boss = await poll(waitingRegistry(), monitorId);

      // "1" is the fake's own cursor after one post of five. Stored unread:
      // the job that holds it in memory is over.
      const [continuation] = await continuationsFor(monitorId);

      expect(continuation?.source).toBe("reddit");
      expect(continuation?.cursor).toBe("1");
      expect(continuation?.attempts).toBe(0);
      expect(continuation?.resumeAfter.getTime()).toBeGreaterThan(before);

      const [, payload, options] = pollSend(boss);

      expect(payload).toEqual({ monitorId });
      expect(options.startAfter?.getTime()).toBe(continuation?.resumeAfter.getTime());
    });

    it("resumes from the stored cursor instead of collecting the query again", async () => {
      const monitorId = await insertMonitor(database);

      await poll(waitingRegistry(), monitorId);
      await theWaitIsOver(monitorId);

      // A second process: a new registry, a new source, a new step. Nothing is
      // carried in memory from the poll that started the collection, so what
      // the resume knows it read from the database.
      const registry = fakeRegistry();
      await poll(registry, monitorId);

      // The cursor the first poll was given. Starting again would send
      // `undefined`, which on Bright Data is a second collection and a second
      // bill for a query already collected.
      expect(callsOf(registry)[0]?.cursor).toBe("1");
      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);

      // Read to the end, so there is nothing left to come back for.
      expect(await continuationsFor(monitorId)).toHaveLength(0);
    });

    it("stores each post once across the wait, and gives each id to the filter once", async () => {
      const monitorId = await insertMonitor(database);

      const first = await poll(waitingRegistry(), monitorId);
      await theWaitIsOver(monitorId);
      const second = await poll(fakeRegistry(), monitorId);

      const handed = [
        ...sentTo(first, filterQueue).postIds,
        ...sentTo(second, filterQueue).postIds,
      ];

      // A resume that re-read the pages before its cursor would classify and
      // bill the same post twice.
      expect(handed).toHaveLength(fakePosts.length);
      expect(new Set(handed).size).toBe(fakePosts.length);
    });

    it("asks the resumed collection for the window the trigger asked for", async () => {
      const lastPolledAt = new Date("2026-07-01T00:00:00.000Z");
      const monitorId = await insertMonitor(database, { lastPolledAt });

      await poll(waitingRegistry(), monitorId);

      const [continuation] = await continuationsFor(monitorId);
      expect(continuation?.since?.getTime()).toBe(lastPolledAt.getTime());

      await theWaitIsOver(monitorId);

      const registry = fakeRegistry();
      await poll(registry, monitorId);

      // Not the poll mark, which the trigger moved to now. Reading that column
      // here would ask for posts newer than the trigger and drop every record
      // the collection was paid for.
      expect(callsOf(registry)[0]?.query.since?.getTime()).toBe(lastPolledAt.getTime());
      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
    });

    it("does not touch the source while the wait it asked for is still running", async () => {
      const monitorId = await insertMonitor(database);
      const resumeAfter = new Date(Date.now() + 60 * 60 * 1000);

      await db
        .insert(sourceContinuations)
        .values({ monitorId, source: "reddit", cursor: "1", resumeAfter });

      const registry = fakeRegistry();
      const boss = await poll(registry, monitorId);

      // A scheduler tick that reached the source here would start a second
      // collection for a snapshot already paid for. That is the cost half of
      // BUG-001.
      expect(callsOf(registry)).toHaveLength(0);
      expect(await db.select().from(posts)).toHaveLength(0);

      const [continuation] = await continuationsFor(monitorId);
      expect(continuation?.cursor).toBe("1");
      expect(continuation?.attempts).toBe(0);

      // The alarm is booked again, so a job lost between polls does not strand
      // the snapshot until the monitor's own interval comes round.
      expect(pollSend(boss)[2].startAfter?.getTime()).toBe(resumeAfter.getTime());
    });

    it("counts a resume that found the collection still not ready", async () => {
      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        cursor: "1",
        resumeAfter: new Date(Date.now() - 1000),
      });

      // An allowance of nothing: every call reports a wait, carrying back the
      // cursor it was given.
      const registry = fakeRegistry({ callsBeforeRateLimit: 0 });
      const boss = await poll(registry, monitorId);

      expect(callsOf(registry)[0]?.cursor).toBe("1");

      const rows = await continuationsFor(monitorId);

      // One row, updated. A second row here is a second collection in flight.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.cursor).toBe("1");
      expect(pollSend(boss)[2].startAfter).toBeInstanceOf(Date);
    });

    it("continues from where the page cap stopped, rather than collecting again", async () => {
      // Twelve posts, one per page, five pages per poll. The pages behind the
      // cap are collected and billed already: a poll that dropped that cursor
      // would make the next one pay for the whole query a second time.
      const many: CandidatePost[] = Array.from({ length: 12 }, (_, index) => ({
        externalId: `paged-${index}`,
        url: `https://example.test/paged/${index}`,
        text: `Post number ${index}`,
        postedAt: new Date("2026-08-10T09:00:00.000Z"),
      }));

      const monitorId = await insertMonitor(database);
      const paged = () => fakeRegistry({ posts: many, pageSize: 1 });

      const boss = await poll(paged(), monitorId);

      const [stopped] = await continuationsFor(monitorId);

      expect(stopped?.cursor).toBe(String(maxPagesPerPoll));
      // Due at once. Nothing was refused by the source, so there is nothing to
      // wait for.
      expect(stopped?.resumeAfter.getTime()).toBeLessThanOrEqual(Date.now());
      expect(pollSend(boss)[2].startAfter).toBeInstanceOf(Date);

      const second = paged();
      await poll(second, monitorId);

      expect(callsOf(second)[0]?.cursor).toBe(String(maxPagesPerPoll));
      expect(await db.select().from(posts)).toHaveLength(2 * maxPagesPerPoll);

      await poll(paged(), monitorId);

      expect(await db.select().from(posts)).toHaveLength(many.length);
      expect(await continuationsFor(monitorId)).toHaveLength(0);
    });

    it("counts only the resumes in a row that brought nothing back", async () => {
      // A long collection read a page at a time must not be abandoned. The cap
      // is for a collection that never becomes ready, not for one that works.
      const many: CandidatePost[] = Array.from({ length: 12 }, (_, index) => ({
        externalId: `counted-${index}`,
        url: `https://example.test/counted/${index}`,
        text: `Post number ${index}`,
        postedAt: new Date("2026-08-10T09:00:00.000Z"),
      }));

      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        cursor: "0",
        resumeAfter: new Date(Date.now() - 1000),
        attempts: maxResumeAttempts - 1,
      });

      await poll(fakeRegistry({ posts: many, pageSize: 1 }), monitorId);

      const [continuation] = await continuationsFor(monitorId);

      expect(continuation?.cursor).toBe(String(maxPagesPerPoll));
      expect(continuation?.attempts).toBe(0);
    });

    it("gives up on a collection that never becomes ready", async () => {
      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        cursor: "1",
        resumeAfter: new Date(Date.now() - 1000),
        attempts: maxResumeAttempts,
      });

      const registry = fakeRegistry();
      const boss = await poll(registry, monitorId);

      // The row goes, so the next scheduled poll starts the query fresh rather
      // than the monitor waiting on a snapshot for ever. Nothing is resumed
      // and nothing is triggered inside this poll: giving up must not itself
      // spend money.
      expect(await continuationsFor(monitorId)).toHaveLength(0);
      expect(callsOf(registry)).toHaveLength(0);
      expect(boss.send).not.toHaveBeenCalled();
    });
  });
  /**
   * The budget guard, at its one call site.
   *
   * docs/testing.md: a rule is only as tested as its least-tested caller. The
   * rule itself is asserted in `budget/budget.test.ts`; what these assert is
   * that this step obeys it, and that it obeys it *before* it reaches a
   * source. A guard that refused after the call would have spent the money.
   */
  describe("the budget guard", () => {
    it("reaches no source once the monthly cap is spent", async () => {
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry();
      const boss = stubBoss();

      // A cap of nothing is a monitor that may spend nothing, and it is the
      // cheapest way to say "the cap is reached" without spending first.
      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "pause" });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, boss),
      );

      expect(callsOf(registry)).toHaveLength(0);
      expect(await db.select().from(posts)).toHaveLength(0);
      // Nothing reached the filter either. A refused poll that still sent an
      // empty batch onward would spend model money on the way.
      expect(boss.send).not.toHaveBeenCalled();
    });

    it("leaves the poll mark alone when it refuses, because nothing was polled", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "notify" });
      await createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

      expect(monitor?.lastPolledAt).toBeNull();
    });

    it("polls a monitor that has a cap with room left in it", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 1_000_000, onExhausted: "pause" });
      await createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
    });

    it("records what each page was billed, against the monitor and the source", async () => {
      // Two units a call, five posts, one post a page: five calls, ten units.
      // At a thousand micro-dollars a unit that is one cent.
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ pageSize: 1, unitsPerCall: 2, pricePerUnitMicros: 1000 });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [usage] = await db.select().from(apiUsage);

      expect(usage?.source).toBe("reddit");
      expect(usage?.units).toBe(10);
      expect(usage?.estimatedCostMicros).toBe(10_000);
    });

    it("records a poll that was billed and brought nothing back", async () => {
      /**
       * The lesson the live run of 2026-09-05 taught, as an assertion. A
       * monitor at the sixty-second floor triggered a collection every minute,
       * and each one billed records and returned no posts because everything
       * it found was older than the last poll. A ledger that only recorded
       * polls with posts in them would have shown that month as free.
       */
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ posts: [], unitsPerCall: 9, pricePerUnitMicros: 1500 });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [usage] = await db.select().from(apiUsage);

      expect(await db.select().from(posts)).toHaveLength(0);
      expect(usage?.units).toBe(9);
      expect(usage?.estimatedCostMicros).toBe(13_500);
    });

    it("records the pages a poll was billed for before it threw", async () => {
      // The reason the ledger is written per page. Two pages came back and
      // were billed; the third throws. Both are on the bill either way.
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ pageSize: 1, unitsPerCall: 4, pricePerUnitMicros: 1000 });
      const source = registry.get("reddit") as SocialSource;
      const search = source.search.bind(source);
      let served = 0;

      source.search = async (request: SearchRequest) => {
        served += 1;
        if (served > 2) throw new Error("the provider hung up");
        return search(request);
      };

      await expect(
        createCollectStep({ registry, credentialsFor: credentials })(
          { monitorId },
          contextFor(db, stubBoss()),
        ),
      ).rejects.toThrow("the provider hung up");

      const [usage] = await db.select().from(apiUsage);

      expect(usage?.units).toBe(8);
    });
  });
});
