/**
 * What a poll writes about itself. US-104.
 *
 * The claim under test is one sentence: **every poll leaves a row, including
 * the polls that do nothing**. So most of these cases drive an exit that
 * collects nothing, because those are the polls a person cannot otherwise
 * explain — and the six of them that return early are exactly where a
 * recorder is easiest to forget.
 *
 * The numbers in the `empty` case are the production run's own shape, scaled
 * down: on 2026-09-09 a monitor polled fifteen times, was billed 82 units, and
 * stored no post. Read that test as the row that would have answered it.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { monitors, pollRuns, posts, sourceContinuations } from "../db/schema.js";
import {
  latestPollRuns,
  pollRunsKeptPerMonitor,
  readPollRuns,
  recordPollRun,
} from "../monitors/poll-runs.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import { fakeSourceDefinition } from "../sources/fake/index.js";
import { createSourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import type { CandidatePost } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { unreachableFetch } from "../testing/network.js";
import { createCollectStep } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

const credentials: CredentialLookup = () => ({ token: "test-token" });

function stubBoss() {
  return { send: vi.fn(async () => "job-1") };
}

function contextFor(db: Database, boss: ReturnType<typeof stubBoss>): StepContext {
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

describe("what a poll records about itself", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_poll_runs");
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

  /** This monitor's rows, oldest first, which is the order they were written in. */
  async function runsOf(monitorId: string) {
    return await db
      .select()
      .from(pollRuns)
      .where(eq(pollRuns.monitorId, monitorId))
      .orderBy(pollRuns.startedAt);
  }

  async function poll(monitorId: string, registry = fakeRegistry()): Promise<void> {
    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );
  }

  it("writes one row saying what the poll collected", async () => {
    const monitorId = await insertMonitor(database);

    await poll(monitorId);

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("collected");
    expect(run?.postsReturned).toBe(fakePosts.length);
    expect(run?.postsNew).toBe(fakePosts.length);
    expect(run?.stopReason).toBeNull();
    expect(run?.userId).toBe("user-1");
    expect(run?.sources).toEqual([
      expect.objectContaining({ source: "reddit", provider: "brightdata", reason: null }),
    ]);
  });

  it("says nothing was new when a second monitor collects the same posts", async () => {
    /**
     * The two numbers exist to be read against each other. Five returned and
     * none new is deduplication working; none returned at all is a different
     * fault with a different repair.
     *
     * Two monitors rather than two polls, because that is the case the
     * deduplication is for: `posts` is keyed by the platform and the post, so
     * a post one monitor stored has still never been matched against another
     * monitor's questions.
     */
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second monitor" });

    await poll(first);
    await poll(second);

    const [firstRun] = await runsOf(first);
    const [secondRun] = await runsOf(second);

    expect(firstRun?.postsNew).toBe(fakePosts.length);

    expect(secondRun?.postsReturned).toBe(fakePosts.length);
    expect(secondRun?.postsNew).toBe(0);
    // Still `collected`: the poll did collect, and what it collected was held.
    expect(secondRun?.outcome).toBe("collected");
  });

  it("records a poll that was billed and returned nothing", async () => {
    /**
     * The production run of 2026-09-09, in miniature. A connector that answers
     * with no posts and bills for the asking is the case the monitor list
     * reported as `Running` for a day.
     *
     * The spend must be on the row. Without it the poll reads as a quiet
     * platform, which is the one reading that is certainly wrong: a quiet
     * platform costs nothing.
     */
    const monitorId = await insertMonitor(database);

    await poll(monitorId, fakeRegistry({ posts: [], unitsPerCall: 3, pricePerUnitMicros: 8_118 }));

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("empty");
    expect(run?.postsReturned).toBe(0);
    expect(run?.postsNew).toBe(0);
    expect(run?.units).toBe(3);
    expect(run?.estimatedCostMicros).toBe(24_354);
    expect(run?.sources).toEqual([
      expect.objectContaining({ source: "reddit", units: 3, postsReturned: 0 }),
    ]);
  });

  it("records the budget refusal, and names no source", async () => {
    /**
     * A refusal is not an empty poll and the row must not read like one. No
     * provider was asked, so there is no per-source line to write, and the
     * reason is the whole of what happened.
     */
    const monitorId = await insertMonitor(database);
    await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "notify" });

    await poll(monitorId);

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("refused");
    expect(run?.stopReason).toBe("budget_exhausted");
    expect(run?.sources).toEqual([]);
    expect(run?.units).toBe(0);
  });

  it("blames one platform without failing the poll that collected on another", async () => {
    /**
     * A poll may skip Reddit for want of a key and collect X in the same run.
     * A poll-level reason alone would report the whole thing as refused, which
     * would send a person to fix a platform that is working.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"] },
    });

    // Only Reddit has a key on this instance.
    const onlyReddit: CredentialLookup = (connector) =>
      connector.provider.id === "brightdata" ? { token: "test-token" } : undefined;

    await createCollectStep({ registry, credentialsFor: onlyReddit })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("collected");
    expect(run?.sources).toEqual([
      expect.objectContaining({ source: "reddit", reason: null }),
      expect.objectContaining({ source: "x", provider: null, reason: "no_credentials" }),
    ]);
    // The first reason, and it is on the row even though the poll collected.
    expect(run?.stopReason).toBe("no_credentials");
  });

  it("names the platform that failed while the poll keeps what it collected", async () => {
    /**
     * BUG-016. The failure has to be on the row, or a poll that lost one
     * platform to an outage reads as a poll that found the platform quiet —
     * and a quiet platform costs nothing, where this one has been billed.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const down = registry.only("x") as unknown as { search: () => Promise<never> };
    down.search = async () => {
      throw new Error("SocialCrawl answered 503: twitter is temporarily unavailable.");
    };

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"] },
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("collected");
    expect(run?.stopReason).toBe("error");
    expect(run?.sources).toEqual([
      expect.objectContaining({ source: "reddit", reason: null }),
      expect.objectContaining({ source: "x", provider: "socialcrawl", reason: "error" }),
    ]);
  });

  it("counts what the connectors returned, not what survived deduplication", async () => {
    /**
     * BUG-015 removed the duplicate before the insert, and this is the number
     * that must not follow it down. A poll that found one post through three
     * queries found one post and paid for three searches, and a row that
     * counted the survivors would hide the half worth acting on.
     */
    const monitorId = await insertMonitor(database);
    const first = fakePosts[0] as CandidatePost;

    await poll(monitorId, fakeRegistry({ posts: [first, first] }));

    const [run] = await runsOf(monitorId);

    expect(run?.postsReturned).toBe(2);
    expect(run?.postsNew).toBe(1);
  });

  it("keeps the continuation of a platform whose provider failed", async () => {
    /**
     * BUG-016. The cursor names pages that are collected and paid for, so
     * forgetting it here would make the next poll buy the whole query again —
     * BUG-001's lesson reached through a different door.
     */
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const down = registry.only("reddit") as unknown as { search: () => Promise<never> };
    down.search = async () => {
      throw new Error("SocialCrawl answered 503: reddit is temporarily unavailable.");
    };

    await db.insert(sourceContinuations).values({
      monitorId,
      source: "reddit",
      provider: "brightdata",
      cursor: "scoped|22|0|",
      resumeAfter: new Date(Date.now() - 1000),
    });

    await expect(
      createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      ),
    ).rejects.toThrow("temporarily unavailable");

    const [kept] = await db
      .select()
      .from(sourceContinuations)
      .where(eq(sourceContinuations.monitorId, monitorId));

    expect(kept?.cursor).toBe("scoped|22|0|");
  });

  it("records a poll that threw, and still lets the job fail", async () => {
    /**
     * pg-boss retries and then dead-letters, and neither reaches a screen. The
     * row is the only thing that will remember, so it is written before the
     * error is rethrown — and rethrown, because this must change what a person
     * can read and not what the queue does.
     */
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const broken = registry.only("reddit") as unknown as { search: () => Promise<never> };
    broken.search = async () => {
      throw new Error("the provider hung up");
    };

    await expect(
      createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      ),
    ).rejects.toThrow("the provider hung up");

    const [run] = await runsOf(monitorId);

    expect(run?.outcome).toBe("failed");
    expect(run?.stopReason).toBe("error");
  });

  it("groups the polls of one collection under one walk", async () => {
    /**
     * Fifteen poll jobs ran for one collection in the production run, because
     * a paging walk resumes itself through the queue. Grouped by the job, one
     * collection reads as fifteen failures.
     */
    const monitorId = await insertMonitor(database, { generatedQueries: ["flaky tests"] });

    // The connector serves one page and then asks to be come back to, which is
    // what leaves a collection in flight.
    const paging = fakeRegistry({
      pageSize: 1,
      callsBeforeRateLimit: 1,
      backOff: "report",
      rateLimitWindowMs: 60_000,
    });

    await poll(monitorId, paging);
    const continuations = await db
      .select()
      .from(sourceContinuations)
      .where(eq(sourceContinuations.monitorId, monitorId));
    expect(continuations.length).toBeGreaterThan(0);

    await poll(monitorId, paging);

    const runs = await runsOf(monitorId);

    expect(runs).toHaveLength(2);
    expect(runs[1]?.walkId).toBe(runs[0]?.walkId);
  });

  it("starts a new walk when nothing is in flight", async () => {
    const monitorId = await insertMonitor(database);

    await poll(monitorId);
    await poll(monitorId);

    const runs = await runsOf(monitorId);

    expect(runs[1]?.walkId).not.toBe(runs[0]?.walkId);
  });
});

describe("reading a monitor's polls back", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("poll_runs_read");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(monitors);
  });

  /** One row, written `secondsAgo` before now so the order is a fact and not a race. */
  async function write(monitorId: string, userId: string, secondsAgo: number) {
    const at = new Date(Date.now() - secondsAgo * 1000);

    return await recordPollRun(db, {
      monitorId,
      userId,
      walkId: crypto.randomUUID(),
      startedAt: at,
      finishedAt: at,
      outcome: "empty",
      postsReturned: 0,
      postsNew: 0,
      units: 0,
      estimatedCostMicros: 0,
      sources: [],
      stopReason: null,
    });
  }

  it("answers with the newest first", async () => {
    const monitorId = await insertMonitor(database);

    await write(monitorId, "user-1", 30);
    const newest = await write(monitorId, "user-1", 1);

    const runs = await readPollRuns(db, "user-1", monitorId);

    expect(runs).toHaveLength(2);
    expect(runs[0]?.id).toBe(newest.id);
  });

  it("answers with nothing for another account's monitor", async () => {
    /**
     * BUG-009 said it in one line: scoping a route means scoping every read in
     * it. The owner is an argument here rather than something this reads from
     * the monitor, so a caller cannot perform the read unscoped.
     */
    const monitorId = await insertMonitor(database, { userId: "owner" });
    await write(monitorId, "owner", 1);

    expect(await readPollRuns(db, "stranger", monitorId)).toEqual([]);
    expect(await latestPollRuns(db, "stranger", [monitorId])).toEqual(new Map());
  });

  it("refuses a monitor that is not the reader's, whoever the rows say wrote them", async () => {
    /**
     * `readPollRuns` has two locks — the monitor's owner, and the owner on the
     * row — and the case above cannot tell them apart, because a poll writes
     * both from the same person. These two cases are what a row separated from
     * its monitor looks like, and each one leaves exactly one lock holding.
     *
     * They are written by hand because a poll cannot produce them. That is the
     * point: a guard nothing can reach is a guard nothing tests.
     */
    const theirs = await insertMonitor(database, { userId: "owner" });
    await write(theirs, "stranger", 1);

    // The rows say the stranger's name; the monitor is not theirs.
    expect(await readPollRuns(db, "stranger", theirs)).toEqual([]);

    const mine = await insertMonitor(database, { userId: "stranger", name: "Mine" });
    await write(mine, "owner", 1);

    // The monitor is theirs; the rows belong to somebody else.
    expect(await readPollRuns(db, "stranger", mine)).toEqual([]);
  });

  it("gives the list screen one row per monitor", async () => {
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second" });

    await write(first, "user-1", 60);
    const firstNewest = await write(first, "user-1", 2);
    const secondOnly = await write(second, "user-1", 5);

    const latest = await latestPollRuns(db, "user-1", [first, second]);

    expect(latest.size).toBe(2);
    expect(latest.get(first)?.id).toBe(firstNewest.id);
    expect(latest.get(second)?.id).toBe(secondOnly.id);
  });

  it("keeps the newest rows and drops the rest", async () => {
    /**
     * A monitor at the 60-second floor writes 1,440 rows a day. Without a
     * bound this becomes the largest table here, and it is a diagnostic rather
     * than a record anybody is owed.
     */
    const monitorId = await insertMonitor(database);

    for (let index = pollRunsKeptPerMonitor + 3; index > 0; index -= 1) {
      await write(monitorId, "user-1", index);
    }

    const kept = await db.select().from(pollRuns).where(eq(pollRuns.monitorId, monitorId));

    expect(kept).toHaveLength(pollRunsKeptPerMonitor);
  });
});
