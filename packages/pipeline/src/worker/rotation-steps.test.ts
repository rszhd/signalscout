/**
 * The turn rule at the poll's door. US-289.
 *
 * `rotation.test.ts` proves the rule; this proves the collect step obeys
 * it — one search a poll at one credit an hour, in order and round again,
 * across platforms and within one; a heavy search runs and then waits; the
 * balance and cursor are written; each search keeps its own window; and a
 * monitor with the column null polls everything, as it always did. The
 * fakes' recorded calls and the poll runs are the evidence.
 */
import {
  createSourceRegistry,
  createSourceRuntime,
  fakeSourceDefinition,
  type SearchRequest,
  type SocialSource,
} from "@signalscout/engine";
import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { monitors, pollRuns, posts, sourceCoverage } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createCollectStep } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import type { StepContext } from "./steps.js";
import { insertMonitor, silentLogger } from "./testing.js";

const credentials: CredentialLookup = () => ({ token: "test-token" });

function contextFor(db: Database): StepContext {
  const boss = { send: vi.fn(async () => "job-1") };
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

/** Four platforms, each a fake that answers nothing: what was asked is the point. */
function fourPlatforms() {
  return createSourceRegistry({
    definitions: (
      [
        ["reddit", "scrapecreators"],
        ["x", "socialdata"],
        ["youtube", "scrapecreators"],
        ["linkedin", "apify"],
      ] as const
    ).map(([id, providerId]) =>
      // A provider the ledger knows: `api_usage` checks the name.
      fakeSourceDefinition({
        id,
        displayName: id,
        providerId,
        providerName: providerId,
        posts: [],
      }),
    ),
    runtime: createSourceRuntime({
      fetch: async () => {
        throw new Error("the network is not for tests");
      },
      logger: silentLogger,
    }),
  });
}

type Registry = ReturnType<typeof fourPlatforms>;
type Fake = SocialSource & { calls: readonly SearchRequest[] };

/** What one platform's fake was asked, as query lists, in order. */
function asked(registry: Registry, platform: string): string[][] {
  return (registry.only(platform) as Fake).calls.map((call) => [...call.query.queries]);
}

describe("a poll whose searches take turns", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_rotation_steps");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(pollRuns);
    await db.delete(sourceCoverage);
    await db.delete(posts);
    await db.delete(monitors);
  });

  async function poll(registry: Registry, monitorId: string, weights = {}) {
    await createCollectStep({ registry, credentialsFor: credentials, creditWeights: weights })(
      { monitorId },
      contextFor(db),
    );
  }

  async function runCount(monitorId: string): Promise<number> {
    return (await db.select().from(pollRuns).where(eq(pollRuns.monitorId, monitorId))).length;
  }

  async function lastRunSources(monitorId: string): Promise<string[] | null> {
    const [run] = await db
      .select({ sources: pollRuns.sources })
      .from(pollRuns)
      .where(eq(pollRuns.monitorId, monitorId))
      .orderBy(desc(pollRuns.startedAt))
      .limit(1);
    return run ? run.sources.map((source) => source.source) : null;
  }

  async function stateOf(monitorId: string) {
    const [row] = await db
      .select({ balance: monitors.pollCreditBalance, cursor: monitors.pollCursor })
      .from(monitors)
      .where(eq(monitors.id, monitorId));
    return { balance: Number(row?.balance), cursor: row?.cursor };
  }

  async function windowsOf(monitorId: string): Promise<string[]> {
    const rows = await db
      .select({ query: sourceCoverage.query })
      .from(sourceCoverage)
      .where(eq(sourceCoverage.monitorId, monitorId));
    return rows.map((row) => row.query).sort();
  }

  it("runs one search a poll at one credit an hour, across platforms, in order and round again", async () => {
    const registry = fourPlatforms();
    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x", "youtube"],
      generatedQueries: { reddit: ["a"], x: ["b"], youtube: ["c"] },
      pollCreditsPerHour: "1",
    });

    for (let i = 0; i < 4; i += 1) await poll(registry, monitorId);

    expect(asked(registry, "reddit")).toEqual([["a"], ["a"]]);
    expect(asked(registry, "x")).toEqual([["b"]]);
    expect(asked(registry, "youtube")).toEqual([["c"]]);
    expect(await stateOf(monitorId)).toEqual({ balance: 0, cursor: 1 });
  });

  it("turns four searches on one platform one at a time, each with its own window", async () => {
    const registry = fourPlatforms();
    const monitorId = await insertMonitor(database, {
      sources: ["reddit"],
      generatedQueries: { reddit: ["a", "b", "c", "d"] },
      pollCreditsPerHour: "1",
    });

    for (let i = 0; i < 5; i += 1) await poll(registry, monitorId);

    expect(asked(registry, "reddit")).toEqual([["a"], ["b"], ["c"], ["d"], ["a"]]);
    // Each search's walk finished, so each has a window of its own, and the
    // fifth poll asked "a" from its window rather than from scratch.
    expect(await windowsOf(monitorId)).toEqual(["a", "b", "c", "d"]);
    expect((registry.only("reddit") as Fake).calls[4]?.query.since).toBeInstanceOf(Date);
    expect((registry.only("reddit") as Fake).calls[0]?.query.since).toBeUndefined();
  });

  it("runs a heavy search, then writes no run while the balance repays it", async () => {
    const registry = fourPlatforms();
    const monitorId = await insertMonitor(database, {
      sources: ["linkedin", "reddit"],
      generatedQueries: { linkedin: ["hiring tools"], reddit: ["flaky tests"] },
      pollCreditsPerHour: "1",
    });

    await poll(registry, monitorId, { linkedin: 5 });
    expect(await lastRunSources(monitorId)).toEqual(["linkedin"]);
    expect(await runCount(monitorId)).toBe(1);
    expect((await stateOf(monitorId)).balance).toBe(-4);

    // Four polls of nothing: the mark moves, the balance climbs, no row.
    for (let i = 0; i < 4; i += 1) await poll(registry, monitorId, { linkedin: 5 });
    expect(await runCount(monitorId)).toBe(1);
    expect((await stateOf(monitorId)).balance).toBe(0);

    await poll(registry, monitorId, { linkedin: 5 });
    expect(await lastRunSources(monitorId)).toEqual(["reddit"]);
  });

  it("lists a platform once in the poll run, however many of its searches ran", async () => {
    const registry = fourPlatforms();
    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["a", "b"], x: ["c"] },
      pollCreditsPerHour: "10",
    });

    await poll(registry, monitorId);
    expect(asked(registry, "reddit")).toEqual([["a"], ["b"]]);
    expect(await lastRunSources(monitorId)).toEqual(["reddit", "x"]);
  });

  it("polls every search on every platform when the column is null, as before", async () => {
    const registry = fourPlatforms();
    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["a", "b"], x: ["c"] },
    });

    await poll(registry, monitorId);
    await poll(registry, monitorId);
    // Both searches in one call, twice, under the platform's own window.
    expect(asked(registry, "reddit")).toEqual([
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(asked(registry, "x")).toEqual([["c"], ["c"]]);
    expect(await windowsOf(monitorId)).toEqual(["", ""]);
    expect(await stateOf(monitorId)).toEqual({ balance: 0, cursor: 0 });
  });
});
