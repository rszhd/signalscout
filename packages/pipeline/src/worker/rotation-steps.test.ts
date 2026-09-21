/**
 * The turn rule at the poll's door. US-289.
 *
 * `rotation.test.ts` proves the rule; this proves the collect step obeys
 * it — one platform a poll at one credit an hour, in order and round
 * again; a heavy platform runs and then waits; the balance and cursor are
 * written; and a monitor with the column null polls every platform, as it
 * always did. The poll runs each poll writes are the evidence: they list
 * the platforms a poll asked.
 */
import {
  createSourceRegistry,
  createSourceRuntime,
  fakeSourceDefinition,
} from "@signalscout/engine";
import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { monitors, pollRuns, posts } from "../db/schema.js";
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

describe("a poll whose platforms take turns", () => {
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
    await db.delete(posts);
    await db.delete(monitors);
  });

  async function poll(monitorId: string, weights = {}) {
    await createCollectStep({
      registry: fourPlatforms(),
      credentialsFor: credentials,
      creditWeights: weights,
    })({ monitorId }, contextFor(db));
  }

  /** The platforms the newest poll run asked, or null when no run was written. */
  async function lastRunSources(monitorId: string): Promise<string[] | null> {
    const [run] = await db
      .select({ sources: pollRuns.sources })
      .from(pollRuns)
      .where(eq(pollRuns.monitorId, monitorId))
      .orderBy(desc(pollRuns.startedAt))
      .limit(1);
    return run ? run.sources.map((source) => source.source) : null;
  }

  async function runCount(monitorId: string): Promise<number> {
    return (await db.select().from(pollRuns).where(eq(pollRuns.monitorId, monitorId))).length;
  }

  async function stateOf(monitorId: string) {
    const [row] = await db
      .select({ balance: monitors.pollCreditBalance, cursor: monitors.pollCursor })
      .from(monitors)
      .where(eq(monitors.id, monitorId));
    return { balance: Number(row?.balance), cursor: row?.cursor };
  }

  it("runs one platform a poll at one credit an hour, in order, and round again", async () => {
    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x", "youtube"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"], youtube: ["flaky tests"] },
      pollCreditsPerHour: "1",
    });

    const asked: (string[] | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await poll(monitorId);
      asked.push(await lastRunSources(monitorId));
    }

    expect(asked).toEqual([["reddit"], ["x"], ["youtube"], ["reddit"]]);
    expect(await stateOf(monitorId)).toEqual({ balance: 0, cursor: 1 });
  });

  it("runs a heavy platform, then writes no run while the balance repays it", async () => {
    const monitorId = await insertMonitor(database, {
      sources: ["linkedin", "reddit"],
      generatedQueries: { linkedin: ["hiring tools"], reddit: ["flaky tests"] },
      pollCreditsPerHour: "1",
    });

    await poll(monitorId, { linkedin: 5 });
    expect(await lastRunSources(monitorId)).toEqual(["linkedin"]);
    expect(await runCount(monitorId)).toBe(1);
    expect((await stateOf(monitorId)).balance).toBe(-4);

    // Four polls of nothing: the mark moves, the balance climbs, no row.
    for (let i = 0; i < 4; i += 1) await poll(monitorId, { linkedin: 5 });
    expect(await runCount(monitorId)).toBe(1);
    expect((await stateOf(monitorId)).balance).toBe(0);

    await poll(monitorId, { linkedin: 5 });
    expect(await lastRunSources(monitorId)).toEqual(["reddit"]);
  });

  it("polls every platform when the column is null, as every monitor did before", async () => {
    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x", "youtube"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"], youtube: ["flaky tests"] },
    });

    await poll(monitorId);
    expect(await lastRunSources(monitorId)).toEqual(["reddit", "x", "youtube"]);
    await poll(monitorId);
    expect(await lastRunSources(monitorId)).toEqual(["reddit", "x", "youtube"]);
    expect(await stateOf(monitorId)).toEqual({ balance: 0, cursor: 0 });
  });
});
