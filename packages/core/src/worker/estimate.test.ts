import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { monitorSpend, recordSourceUsage, setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, monitors, queryEstimateProbes, queryEstimates } from "../db/schema.js";
import { maxEstimateAttempts, samplePostsPerProbe, samplesKept } from "../estimate/estimate.js";
import { readEstimate, startEstimate } from "../estimate/runs.js";
import { fakeSourceDefinition } from "../sources/fake/index.js";
import { createSourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import type { CandidatePost, SearchRequest, SocialSource } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { unreachableFetch } from "../testing/network.js";
import type { CredentialLookup } from "./credentials.js";
import { createEstimateStep } from "./estimate.js";
import { estimateQueue } from "./queues.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

/**
 * The cost test, driven without a queue.
 *
 * The source is the fake connector over a `fetch` that cannot reach anything,
 * so "this test spends no money" is a property of the setup rather than a
 * claim about the code. docs/testing.md.
 *
 * The posts are built here rather than taken from the fixtures, because a
 * sample looks back one week from the moment it runs and the fixtures are
 * dated August 2026. A sample of posts nothing would return proves nothing.
 */
const credentials: CredentialLookup = () => ({ token: "test-token" });

const hourAgo = (hours: number): Date => new Date(Date.now() - hours * 60 * 60 * 1000);

function recentPosts(count: number, hoursApart = 1): CandidatePost[] {
  return Array.from({ length: count }, (_, index) => ({
    externalId: `recent-${index}`,
    url: `https://example.test/recent/${index}`,
    author: "someone",
    channel: "SaaS",
    title: `Post ${index}`,
    text: `A person describing a problem, number ${index}.`,
    postedAt: hourAgo((index + 1) * hoursApart),
  }));
}

function stubBoss() {
  return {
    send: vi.fn(async (_queue: string, _payload: unknown, _options?: unknown) => "job-1"),
  };
}

function contextFor(db: Database, boss: ReturnType<typeof stubBoss>): StepContext {
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

function callsOf(registry: ReturnType<typeof fakeRegistry>): readonly SearchRequest[] {
  return (registry.get("reddit") as SocialSource & { calls: readonly SearchRequest[] }).calls;
}

/** A connector that refuses one term and serves every other. */
function pickyRegistry(refuse: string) {
  const posts = recentPosts(4);

  return createSourceRegistry({
    definitions: [
      {
        id: "reddit",
        displayName: "Reddit",
        billableUnit: "record",
        pricePerUnitMicros: 1500,
        maxUnitsPerQueryPoll: 50,
        credentialFields: [{ name: "token", label: "Token", secret: true }],
        create: (): SocialSource => ({
          id: "reddit",
          displayName: "Reddit",
          billableUnit: "record",
          pricePerUnitMicros: 1500,
          maxUnitsPerQueryPoll: 50,
          credentialFields: [{ name: "token", label: "Token", secret: true }],
          validateCredentials: async () => ({ valid: true }),
          search: async (request) => {
            if ([...request.query.queries, ...request.query.channels].includes(refuse)) {
              throw new Error("Bright Data refused the query (keyword: not allowed).");
            }

            return { posts, unitsConsumed: posts.length, next: { status: "done" } };
          },
        }),
      },
    ],
    runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
  });
}

describe("the cost test", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_estimate");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(queryEstimates);
    await db.delete(apiUsage);
    await db.delete(monitors);
  });

  async function runOf(
    probes: readonly { source: "reddit"; kind: "query" | "channel"; term: string }[],
    options: { monitorId?: string; capMicros?: number; pollIntervalSeconds?: number } = {},
  ): Promise<string> {
    return startEstimate(db, {
      monitorId: options.monitorId ?? null,
      pollIntervalSeconds: options.pollIntervalSeconds ?? 3600,
      monthlyCapMicros: options.capMicros ?? null,
      probes,
    });
  }

  it("asks the source for one query at a time, over a one-week window", async () => {
    // One probe per query is the whole point: "your plan is too broad" is not
    // an instruction, and "this line costs $54" is.
    const estimateId = await runOf([
      { source: "reddit", kind: "query", term: "flaky end to end tests" },
      { source: "reddit", kind: "query", term: "ui changes break tests" },
      { source: "reddit", kind: "channel", term: "SaaS" },
    ]);
    const registry = fakeRegistry({ posts: recentPosts(4) });

    await createEstimateStep({ registry, credentialsFor: credentials })(
      { estimateId },
      contextFor(db, stubBoss()),
    );

    const asked = callsOf(registry);

    expect(asked).toHaveLength(3);
    expect(asked.map((call) => call.query.queries)).toEqual([
      ["flaky end to end tests"],
      ["ui changes break tests"],
      [],
    ]);
    expect(asked.map((call) => call.query.channels)).toEqual([[], [], ["SaaS"]]);
    expect(asked.every((call) => call.limit === samplePostsPerProbe)).toBe(true);

    // Seven days back, to the hour.
    const since = asked[0]?.query.since;
    const days = since ? (Date.now() - since.getTime()) / 86_400_000 : 0;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("records what the sample found, and keeps a few posts to judge it by", async () => {
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(4, 6) }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const run = await readEstimate(db, estimateId);
    const probe = run?.probes[0];

    expect(run?.status).toBe("ready");
    expect(probe?.status).toBe("ready");
    expect(probe?.postsFound).toBe(4);
    // Four posts, six hours apart, and the source said it had no more.
    expect(probe?.capped).toBe(false);
    expect(probe?.samples).toHaveLength(samplesKept);
    // The newest first: a person judges a query by what it is finding now.
    expect(probe?.samples[0]?.title).toBe("Post 0");
    expect(probe?.oldestPostAt?.getTime()).toBeLessThan(probe?.newestPostAt?.getTime() ?? 0);
  });

  it("says a sample was stopped when it came back full", async () => {
    // Twelve posts available and ten asked for. The rate this measures is a
    // floor, and the projection has to be told so.
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(12) }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const probe = (await readEstimate(db, estimateId))?.probes[0];

    expect(probe?.postsFound).toBe(samplePostsPerProbe);
    expect(probe?.capped).toBe(true);
  });

  it("says a sample was stopped when it came back exactly full", async () => {
    // Ten posts available and ten asked for, and the source says it is done.
    // It is done because our own limit truncated it, which is the Reddit
    // case: `limit_per_input` decides how much the snapshot holds. A sample
    // that filled its own limit is a floor whatever the source says next.
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(samplePostsPerProbe) }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const probe = (await readEstimate(db, estimateId))?.probes[0];

    expect(probe?.postsFound).toBe(samplePostsPerProbe);
    expect(probe?.capped).toBe(true);
  });

  it("keeps reading a source that hands back short pages", async () => {
    // "A short page is not the last page", from the caller's side. Stopping on
    // the first two would report a query as six times quieter than it is.
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(6), pageSize: 2 }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const probe = (await readEstimate(db, estimateId))?.probes[0];

    expect(probe?.postsFound).toBe(6);
    expect(probe?.capped).toBe(false);
  });

  it("writes what the test spent to the ledger, against no monitor", async () => {
    // The test runs before the monitor exists, which is the point of it. The
    // row is on the bill and on no monitor's cap. `model_calls` already says
    // the same thing about a query generated from the form.
    const monitorId = await insertMonitor(database);
    const estimateId = await runOf([
      { source: "reddit", kind: "query", term: "flaky tests" },
      { source: "reddit", kind: "query", term: "broken ci" },
    ]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(4), unitsPerCall: 4, pricePerUnitMicros: 1500 }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const [usage] = await db.select().from(apiUsage);

    expect(usage?.monitorId).toBeNull();
    // Two probes, four records each, at $1.50 a thousand: twelve thousandths
    // of a dollar.
    expect(usage?.units).toBe(8);
    expect(usage?.estimatedCostMicros).toBe(12_000);

    // And no monitor's own spend moved.
    expect((await monitorSpend(db, monitorId)).totalMicros).toBe(0);

    const run = await readEstimate(db, estimateId);
    expect(run?.units).toBe(8);
    expect(run?.estimatedCostMicros).toBe(12_000);
  });

  it("charges the monitor when an existing monitor is retested", async () => {
    const monitorId = await insertMonitor(database);
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }], {
      monitorId,
    });

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(4), unitsPerCall: 4, pricePerUnitMicros: 1500 }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const [usage] = await db.select().from(apiUsage);

    expect(usage?.monitorId).toBe(monitorId);
    expect((await monitorSpend(db, monitorId)).totalMicros).toBe(6_000);
  });

  it("keeps the cursor of a sample the source is still collecting, and comes back", async () => {
    // The BUG-001 shape. A collection is billed when it is triggered, so a
    // dropped cursor is money spent on records nobody reads.
    const estimateId = await runOf([
      { source: "reddit", kind: "query", term: "flaky tests" },
      { source: "reddit", kind: "query", term: "broken ci" },
    ]);
    /**
     * The source's own clock, moved by hand.
     *
     * docs/testing.md: a wait in milliseconds is a race, not an ordering. It
     * starts two minutes ago so the source's "come back in a minute" is a
     * moment the step's real clock has already passed, and the second run
     * finds the sample due rather than waiting for it.
     */
    let clock = new Date(Date.now() - 120_000);
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          posts: recentPosts(4),
          callsBeforeRateLimit: 1,
          rateLimitWindowMs: 60_000,
        }),
      ],
      runtime: createSourceRuntime({
        fetch: unreachableFetch,
        logger: silentLogger,
        now: () => clock,
      }),
    });
    const step = createEstimateStep({ registry, credentialsFor: credentials });
    const boss = stubBoss();

    await step({ estimateId }, contextFor(db, boss));

    const midway = await readEstimate(db, estimateId);

    expect(midway?.status).toBe("collecting");
    expect(midway?.probes.map((probe) => probe.status)).toEqual(["ready", "collecting"]);
    expect(midway?.probes[1]?.resumeAfter).not.toBeNull();
    expect(midway?.probes[1]?.attempts).toBe(1);

    const booked = boss.send.mock.calls.find(([queue]) => queue === estimateQueue);
    expect(booked?.[1]).toEqual({ estimateId });

    // The source's allowance comes back, and the resume finds the second
    // query. The first is not asked again: it was paid for and it is stored.
    clock = new Date();
    await step({ estimateId }, contextFor(db, boss));

    const finished = await readEstimate(db, estimateId);

    expect(finished?.status).toBe("ready");
    expect(finished?.probes.every((probe) => probe.status === "ready")).toBe(true);
    expect(callsOf(registry).map((call) => call.query.queries)).toEqual([
      ["flaky tests"],
      ["broken ci"],
      ["broken ci"],
    ]);
  });

  it("keeps the cursor the source issued, and reads the collection it paid for", async () => {
    /**
     * Correctness-critical: cursor and deduplication. This is Bright Data's
     * shape — a trigger that bills the collection, a wait, and a cursor naming
     * the snapshot. A resume that dropped the cursor would trigger a second
     * collection and be billed for the same records twice. BUG-001.
     */
    const asked: (string | undefined)[] = [];
    const registry = createSourceRegistry({
      definitions: [
        {
          id: "reddit",
          displayName: "Reddit",
          billableUnit: "record",
          pricePerUnitMicros: 1500,
          maxUnitsPerQueryPoll: 50,
          credentialFields: [{ name: "token", label: "Token", secret: true }],
          create: (): SocialSource => ({
            id: "reddit",
            displayName: "Reddit",
            billableUnit: "record",
            pricePerUnitMicros: 1500,
            maxUnitsPerQueryPoll: 50,
            credentialFields: [{ name: "token", label: "Token", secret: true }],
            validateCredentials: async () => ({ valid: true }),
            search: async (request) => {
              asked.push(request.cursor);

              if (request.cursor === undefined) {
                // Triggered, and billed nothing yet. Come back for it.
                return {
                  posts: [],
                  unitsConsumed: 0,
                  next: {
                    status: "wait",
                    retryAfter: new Date(Date.now() - 1_000),
                    cursor: "snapshot-1",
                  },
                };
              }

              if (request.cursor !== "snapshot-1") {
                throw new Error(
                  `reddit: cursor "${request.cursor}" was not issued by this source.`,
                );
              }

              return { posts: recentPosts(4), unitsConsumed: 9, next: { status: "done" } };
            },
          }),
        },
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);
    const step = createEstimateStep({ registry, credentialsFor: credentials });

    await step({ estimateId }, contextFor(db, stubBoss()));

    expect((await readEstimate(db, estimateId))?.probes[0]?.cursor).toBe("snapshot-1");

    await step({ estimateId }, contextFor(db, stubBoss()));

    const run = await readEstimate(db, estimateId);

    // The second call read the snapshot the first one paid for, rather than
    // starting the query again.
    expect(asked).toEqual([undefined, "snapshot-1"]);
    expect(run?.status).toBe("ready");
    expect(run?.probes[0]?.postsFound).toBe(4);
    // Nine records is what the provider said it collected, not the four posts
    // that survived our own filter.
    expect(run?.units).toBe(9);
  });

  it("does not buy a sample again before the source said to come back", async () => {
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);
    const soon = new Date(Date.now() + 60 * 60 * 1000);

    await db
      .update(queryEstimateProbes)
      .set({ cursor: "snapshot-1", resumeAfter: soon })
      .where(eq(queryEstimateProbes.estimateId, estimateId));

    const registry = fakeRegistry({ posts: recentPosts(4) });
    const boss = stubBoss();

    await createEstimateStep({ registry, credentialsFor: credentials })(
      { estimateId },
      contextFor(db, boss),
    );

    expect(callsOf(registry)).toHaveLength(0);
    expect((await readEstimate(db, estimateId))?.status).toBe("collecting");

    // And it comes back at the moment the source named, not before it.
    const booked = boss.send.mock.calls.find(([queue]) => queue === estimateQueue);
    expect((booked?.[2] as { startAfter?: Date } | undefined)?.startAfter).toEqual(soon);
  });

  it("gives up on a sample that never becomes ready", async () => {
    // Twenty resumes at the provider's own thirty-second hint is ten minutes.
    // A person is watching this, and a spinner that never stops is worse than
    // a sentence saying it did not work.
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await db
      .update(queryEstimateProbes)
      .set({ attempts: maxEstimateAttempts })
      .where(eq(queryEstimateProbes.estimateId, estimateId));

    const registry = fakeRegistry({ posts: recentPosts(4) });

    await createEstimateStep({ registry, credentialsFor: credentials })(
      { estimateId },
      contextFor(db, stubBoss()),
    );

    const run = await readEstimate(db, estimateId);

    expect(run?.status).toBe("failed");
    expect(run?.probes[0]?.status).toBe("failed");
    expect(run?.probes[0]?.error).toMatch(/never finished collecting/i);
    expect(callsOf(registry)).toHaveLength(0);
  });

  it("fails one query the source refused and keeps the numbers for the rest", async () => {
    const estimateId = await runOf([
      { source: "reddit", kind: "query", term: "flaky tests" },
      { source: "reddit", kind: "query", term: "boom" },
    ]);

    await createEstimateStep({
      registry: pickyRegistry("boom"),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    const run = await readEstimate(db, estimateId);

    // One line with a reason, and one with a measurement. A run is not lost
    // because one query of eight was refused.
    expect(run?.status).toBe("ready");
    expect(run?.probes[0]?.status).toBe("ready");
    expect(run?.probes[1]?.status).toBe("failed");
    expect(run?.probes[1]?.error).toMatch(/refused the query/i);
  });

  it("says which key is missing rather than asking the source without one", async () => {
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);
    const registry = fakeRegistry({ posts: recentPosts(4) });

    await createEstimateStep({ registry, credentialsFor: () => undefined })(
      { estimateId },
      contextFor(db, stubBoss()),
    );

    const run = await readEstimate(db, estimateId);

    expect(run?.status).toBe("failed");
    expect(run?.probes[0]?.error).toMatch(/Reddit has no credentials/i);
    expect(callsOf(registry)).toHaveLength(0);
  });

  it("refuses to spend a monitor's money when its budget is gone", async () => {
    // docs/testing.md counts this as the budget guard's third caller, and a
    // rule is only as tested as its least-tested caller.
    const monitorId = await insertMonitor(database);
    await setBudget(db, monitorId, { monthlyCapMicros: 10_000, onExhausted: "notify" });
    await recordSourceUsage(db, {
      monitorId,
      source: "reddit",
      units: 10,
      pricePerUnitMicros: 1500,
    });

    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }], {
      monitorId,
    });
    const registry = fakeRegistry({ posts: recentPosts(4) });

    await createEstimateStep({ registry, credentialsFor: credentials })(
      { estimateId },
      contextFor(db, stubBoss()),
    );

    const run = await readEstimate(db, estimateId);

    expect(callsOf(registry)).toHaveLength(0);
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/monthly budget/i);
    expect(run?.probes[0]?.status).toBe("failed");
  });

  it("tests a plan that has no monitor even when another monitor is exhausted", async () => {
    // The cap belongs to a monitor. A plan that is still a plan has none, and
    // refusing it because some other monitor is out of budget would stop the
    // one screen that exists to prevent the next runaway.
    const monitorId = await insertMonitor(database);
    await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "pause" });

    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);

    await createEstimateStep({
      registry: fakeRegistry({ posts: recentPosts(4) }),
      credentialsFor: credentials,
    })({ estimateId }, contextFor(db, stubBoss()));

    expect((await readEstimate(db, estimateId))?.status).toBe("ready");
  });

  it("does nothing to a run that has already finished", async () => {
    const estimateId = await runOf([{ source: "reddit", kind: "query", term: "flaky tests" }]);
    const registry = fakeRegistry({ posts: recentPosts(4) });
    const step = createEstimateStep({ registry, credentialsFor: credentials });

    await step({ estimateId }, contextFor(db, stubBoss()));
    const finishedAt = (await readEstimate(db, estimateId))?.finishedAt;

    await step({ estimateId }, contextFor(db, stubBoss()));

    // The second run must not buy the same sample again, and must not move
    // the moment the test finished: that moment is on the screen.
    expect(callsOf(registry)).toHaveLength(1);
    expect((await readEstimate(db, estimateId))?.finishedAt).toEqual(finishedAt);
  });
});
