/**
 * Which of a monitor's inputs found which post. US-212.
 *
 * The claim is one sentence: **the association is recorded at the only moment
 * anything knows it**. A connector loops per phrase and per channel, and one
 * line later the pages are merged and the answer is gone — so these cases
 * drive the real collect step and read the rows it leaves.
 *
 * The other half is what the association is worth: a phrase that finds posts
 * and never matches is the expensive kind of wrong, and `queryPerformance` is
 * what makes it visible.
 */

import { fakePosts } from "@signalscout/engine";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { matches, monitors, postDiscoveries, posts } from "../db/schema.js";
import { queryPerformance } from "../monitors/query-performance.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createCollectStep } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

const credentials: CredentialLookup = () => ({ token: "test-token" });

function stubBoss() {
  return { send: vi.fn(async (_queue: string, _payload: Record<string, unknown>) => "job-1") };
}

function contextFor(db: Database): StepContext {
  return { db, boss: stubBoss() as unknown as StepContext["boss"], logger: silentLogger };
}

describe("which input found a post", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_discoveries");
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

  async function poll(monitorId: string): Promise<void> {
    await createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
      { monitorId },
      contextFor(db),
    );
  }

  async function discoveriesOf(monitorId: string) {
    return db
      .select()
      .from(postDiscoveries)
      .where(eq(postDiscoveries.monitorId, monitorId))
      .orderBy(postDiscoveries.value);
  }

  it("records the phrase the poll was searching", async () => {
    const monitorId = await insertMonitor(database, {
      generatedQueries: ["flaky end to end tests"],
      generatedSubreddits: [],
    });

    await poll(monitorId);

    const rows = await discoveriesOf(monitorId);

    expect(rows).toHaveLength(fakePosts.length);
    expect(rows[0]).toMatchObject({
      kind: "query",
      value: "flaky end to end tests",
      source: "reddit",
    });
  });

  /**
   * A post two monitors found is one row in `posts` and one row each here.
   * The table exists because the post cannot hold this: it is keyed by source
   * and external id, with no monitor column.
   */
  it("keeps one monitor's answer apart from another's", async () => {
    const mine = await insertMonitor(database, { generatedQueries: ["mine"] });
    const theirs = await insertMonitor(database, {
      name: "Second monitor",
      generatedQueries: ["theirs"],
    });

    await poll(mine);
    await poll(theirs);

    expect((await discoveriesOf(mine)).every((row) => row.value === "mine")).toBe(true);
    expect((await discoveriesOf(theirs)).every((row) => row.value === "theirs")).toBe(true);
  });

  it("writes nothing new when the same poll runs again", async () => {
    // The primary key is the monitor, the post and the input. A second poll
    // finding the same post through the same phrase has nothing to add.
    const monitorId = await insertMonitor(database, { generatedQueries: ["flaky tests"] });

    await poll(monitorId);
    const first = await discoveriesOf(monitorId);
    await poll(monitorId);

    expect(await discoveriesOf(monitorId)).toHaveLength(first.length);
  });

  describe("what an input is worth", () => {
    it("counts posts, matches and the best score, best first", async () => {
      const monitorId = await insertMonitor(database, { generatedQueries: ["flaky tests"] });
      await poll(monitorId);

      const found = await db.select({ id: posts.id }).from(posts);
      const [first, second] = found;
      if (!first || !second) throw new Error("the poll stored nothing to score");

      await db.insert(matches).values([
        {
          monitorId,
          postId: first.id,
          score: 91,
          relevance: 90,
          problemFit: 90,
          icpFit: 90,
          intent: 90,
          urgency: 90,
          intentType: "problem",
          reasons: ["A team describes broken tests"],
        },
        {
          monitorId,
          postId: second.id,
          score: 64,
          relevance: 60,
          problemFit: 60,
          icpFit: 60,
          intent: 60,
          urgency: 60,
          intentType: "problem",
          reasons: ["A weaker one"],
        },
      ]);

      const [input] = await queryPerformance(db, "user-1", monitorId);

      expect(input).toMatchObject({
        kind: "query",
        value: "flaky tests",
        posts: fakePosts.length,
        matches: 2,
        bestScore: 91,
      });
      expect(input?.lastFoundAt).toBeInstanceOf(Date);
      expect(input?.lastMatchedAt).toBeInstanceOf(Date);
    });

    it("counts a match only at or above the monitor's floor, and never a hidden one", async () => {
      // US-267. The number beside a phrase and the number at the top of the
      // page use one floor, or a person cannot reconcile them.
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["flaky tests"],
        minScore: 60,
      });
      await poll(monitorId);

      const found = await db.select({ id: posts.id }).from(posts);
      const [first, second, third] = found;
      if (!first || !second || !third) throw new Error("the poll stored too little to score");

      const scored = (postId: string, score: number, hidden = false) => ({
        monitorId,
        postId,
        score,
        relevance: score,
        problemFit: score,
        icpFit: score,
        intent: score,
        urgency: score,
        intentType: "problem" as const,
        reasons: ["A reason"],
        hidden,
      });
      await db
        .insert(matches)
        .values([scored(first.id, 91), scored(second.id, 45), scored(third.id, 88, true)]);

      const [input] = await queryPerformance(db, "user-1", monitorId);

      expect(input?.posts).toBe(fakePosts.length);
      expect(input?.matches).toBe(1);
      expect(input?.bestScore).toBe(91);
    });

    it("shows a phrase that finds posts and never matches", async () => {
      // The expensive kind of wrong, and the reason for the whole table: it is
      // searched on every poll for ever and nothing comes of it.
      const monitorId = await insertMonitor(database, { generatedQueries: ["finds nothing"] });
      await poll(monitorId);

      const [input] = await queryPerformance(db, "user-1", monitorId);

      expect(input?.posts).toBe(fakePosts.length);
      expect(input?.matches).toBe(0);
      expect(input?.bestScore).toBeNull();
    });

    it("answers nothing for somebody else's monitor", async () => {
      const monitorId = await insertMonitor(database, { generatedQueries: ["mine"] });
      await poll(monitorId);

      expect(await queryPerformance(db, "somebody-else", monitorId)).toEqual([]);
    });
  });
});
