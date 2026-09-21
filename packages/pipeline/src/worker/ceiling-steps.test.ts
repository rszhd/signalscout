/**
 * The ceiling at the two doors it guards: `classify` and `replies`. US-287.
 *
 * `ceiling.test.ts` proves the count; this proves what the steps do with it —
 * a first poll's backlog is read up to the number and the rest written as
 * drops, a drop is not read the next day, and a thread is not opened once
 * its pair's day is spent. Both steps are driven directly, the way
 * `stage-runs.test.ts` drives them, with a stub classifier and the fake
 * source: nothing here reaches a model or a provider.
 */
import type {
  CandidateReply,
  Classification,
  ClassificationOutcome,
  Classifier,
  ModelCall,
} from "@signalscout/engine";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import {
  filterDrops,
  matches,
  modelCalls,
  monitors,
  postDiscoveries,
  posts,
} from "../db/schema.js";
import { filterDropCounts } from "../filter/drops.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import { createRepliesStep } from "./replies.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

const call: ModelCall = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens: 900,
  outputTokens: 120,
  latencyMs: 200,
  estimatedCostMicros: 250,
};

const classification: Classification = {
  reasons: ["Four-person SaaS team", "Manual testing every release", "Asking for tools"],
  relevance: 98,
  problemFit: 96,
  icpFit: 91,
  intent: 88,
  urgency: 82,
  intentType: "recommendation_request",
};

const scored: ClassificationOutcome = {
  status: "scored",
  classification,
  score: 92,
  removedReasons: [],
  call,
};

/** A classifier that scores everything, and counts how often it was asked. */
function countingClassifier(): { classifier: Classifier; asked: () => number } {
  let asked = 0;
  return {
    classifier: {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      classify: async () => {
        asked += 1;
        return scored;
      },
    },
    asked: () => asked,
  };
}

function contextFor(db: Database): StepContext {
  const boss = { send: vi.fn(async () => "job-1") };
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

const postedAt = new Date("2026-09-21T06:00:00Z");

describe("the ceiling at the doors", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_ceiling_steps");
    ({ db, close } = createDatabase(database.url));
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await database?.drop();
  });

  afterEach(async () => {
    await db.delete(modelCalls);
    await db.delete(filterDrops);
    await db.delete(matches);
    await db.delete(postDiscoveries);
    await db.delete(posts);
    await db.delete(monitors);
  });

  let serial = 0;

  /** A post this monitor's query found, stored as the collect step stores it. */
  async function foundPost(
    monitorId: string,
    value = "flaky tests",
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    serial += 1;
    const [row] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId: `t3_${serial}`,
        url: `https://www.reddit.com/r/SaaS/comments/t3_${serial}/`,
        channel: "SaaS",
        title: "Our end to end tests break every release",
        excerpt: "We are a four-person SaaS and the suite breaks whenever the UI changes.",
        postedAt,
        ...overrides,
      })
      .returning({ id: posts.id });
    if (!row) throw new Error("no post");
    await db
      .insert(postDiscoveries)
      .values({ monitorId, postId: row.id, source: "reddit", kind: "query", value });
    return row.id;
  }

  async function dropsOf(monitorId: string) {
    return db
      .select({ postId: filterDrops.postId, stage: filterDrops.stage })
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.stage, "ceiling")));
  }

  describe("classify", () => {
    /**
     * The first poll of a new query is its whole backlog. US-287: the first
     * 25 are read, the rest are written as drops, and the screen's count
     * says so.
     */
    it("reads a first poll's backlog up to the number and writes the rest as drops", async () => {
      const monitorId = await insertMonitor(database);
      const ids: string[] = [];
      for (let i = 0; i < 30; i += 1) ids.push(await foundPost(monitorId));
      const { classifier, asked } = countingClassifier();

      await createClassifyStep({
        classifierFor: async () => classifier,
        newPostsPerPairPerDay: 25,
      })({ monitorId, postIds: ids }, contextFor(db));

      expect(asked()).toBe(25);
      const drops = await dropsOf(monitorId);
      expect(drops).toHaveLength(5);
      expect(new Set(drops.map((drop) => drop.postId))).toEqual(new Set(ids.slice(25)));
      // What the screen counts, beside the filter's own stages.
      expect((await filterDropCounts(db, [monitorId])).get(monitorId)?.ceiling).toBe(5);
    });

    it("does not read a post it refused, even when a later poll hands it over again", async () => {
      const monitorId = await insertMonitor(database);
      const first = await foundPost(monitorId);
      const second = await foundPost(monitorId);
      const { classifier, asked } = countingClassifier();
      const step = createClassifyStep({
        classifierFor: async () => classifier,
        newPostsPerPairPerDay: 1,
      });

      await step({ monitorId, postIds: [first, second] }, contextFor(db));
      expect(asked()).toBe(1);
      expect((await dropsOf(monitorId)).map((drop) => drop.postId)).toEqual([second]);

      // The same ids again, as a retry or the next poll would send them: the
      // first is already scored, the second is a drop. Nothing is asked.
      await step({ monitorId, postIds: [first, second] }, contextFor(db));
      expect(asked()).toBe(1);
    });

    it("counts the day from the ledger, across jobs", async () => {
      const monitorId = await insertMonitor(database);
      const { classifier, asked } = countingClassifier();
      const step = createClassifyStep({
        classifierFor: async () => classifier,
        newPostsPerPairPerDay: 3,
      });

      await step(
        { monitorId, postIds: [await foundPost(monitorId), await foundPost(monitorId)] },
        contextFor(db),
      );
      expect(asked()).toBe(2);

      // Two of three used by the earlier job; one more fits and one does not.
      const third = await foundPost(monitorId);
      const fourth = await foundPost(monitorId);
      await step({ monitorId, postIds: [third, fourth] }, contextFor(db));
      expect(asked()).toBe(3);
      expect((await dropsOf(monitorId)).map((drop) => drop.postId)).toEqual([fourth]);
    });

    it("reads everything when no number is set", async () => {
      const monitorId = await insertMonitor(database);
      const ids: string[] = [];
      for (let i = 0; i < 6; i += 1) ids.push(await foundPost(monitorId));
      const { classifier, asked } = countingClassifier();

      await createClassifyStep({ classifierFor: async () => classifier })(
        { monitorId, postIds: ids },
        contextFor(db),
      );

      expect(asked()).toBe(6);
      expect(await dropsOf(monitorId)).toHaveLength(0);
    });
  });

  describe("replies", () => {
    function threadUnder(postExternalId: string): readonly CandidateReply[] {
      return [
        {
          externalId: `t1_${postExternalId}_one`,
          url: `https://www.reddit.com/r/SaaS/comments/${postExternalId}/comment/one/`,
          author: "a-redditor",
          channel: "SaaS",
          text: "We hit this too. What did you end up using?",
          postedAt,
          parentPostExternalId: postExternalId,
        },
      ];
    }

    it("opens no thread for a post whose pair's day is spent, and one for a pair with room", async () => {
      const monitorId = await insertMonitor(database, { includeReplies: true });
      const spent = await foundPost(monitorId, "flaky tests", { replyCount: 1 });
      const fresh = await foundPost(monitorId, "manual testing", { replyCount: 1 });
      // The "flaky tests" pair has put its one post to the classifier today.
      await db.insert(modelCalls).values({
        monitorId,
        postId: spent,
        userId: "user-1",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        purpose: "classification",
        outcome: "scored",
        monitorVersion: 1,
        latencyMs: 1,
        estimatedCostMicros: 250,
      });
      const requests: string[] = [];

      await createRepliesStep({
        registry: fakeRegistry({
          replies: threadUnder,
          unitsPerReplyCall: 1,
          onFetchReplies: (request) => requests.push(request.postExternalId),
        }),
        credentialsFor: () => ({ token: "test-token" }),
        newPostsPerPairPerDay: 1,
      })({ monitorId, postIds: [spent, fresh] }, contextFor(db));

      const [freshRow] = await db
        .select({ externalId: posts.externalId })
        .from(posts)
        .where(eq(posts.id, fresh));
      expect(requests).toEqual([freshRow?.externalId]);
    });
  });
});
