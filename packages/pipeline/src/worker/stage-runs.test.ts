/**
 * What a stage writes about itself. US-201.
 *
 * `poll-runs.test.ts` is the model, and the claim is the same sentence one
 * stage later: **every run leaves a row, including the runs that do nothing**.
 * So most of these cases drive an exit that produces nothing — a filter that
 * dropped everything, a classifier with no model, a classifier the cap stopped
 * — because those are the runs a person cannot otherwise explain, and they are
 * where a recorder is easiest to forget.
 *
 * The steps are driven directly, with a stub queue. What each step does with
 * the posts is asserted in its own file; what is asserted here is the row it
 * leaves behind.
 */

import type {
  Classification,
  ClassificationOutcome,
  Classifier,
  ModelCall,
} from "@signalscout/engine";
import { fakePosts } from "@signalscout/engine";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { matches, monitors, posts, stageRuns } from "../db/schema.js";
import { readStageRuns, recordStageRun, stageRunsKeptPerMonitor } from "../monitors/stage-runs.js";
import { notificationDefaults, saveNotificationSettings } from "../notifications/settings.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import { createFilterStep } from "./filter.js";
import { createNotifyStep } from "./notify.js";
import { createRepliesStep } from "./replies.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger } from "./testing.js";

/** The four-person SaaS post: the strongest of the fixtures. */
const strongPost = fakePosts[3] as (typeof fakePosts)[number];
/** A post about sourdough. No query of this monitor is in it. */
const offTopicPost = fakePosts[4] as (typeof fakePosts)[number];

const call: ModelCall = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens: 900,
  outputTokens: 120,
  latencyMs: 200,
  estimatedCostMicros: 1_500,
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

/**
 * A classifier that answers however the case needs.
 *
 * Hand-written, and that is allowed here for `monitors.test.ts`' reason:
 * `Classifier` is our own interface and the three outcomes are our own words.
 * The evidence about what a real model returns lives in `classify.test.ts`,
 * which drives the real classifier over a stub model.
 */
function stubClassifier(outcome: () => ClassificationOutcome): Classifier {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    classify: async () => outcome(),
  };
}

const scored: ClassificationOutcome = { status: "scored", classification, score: 92, call };

/** The queue, as a step sees it. Typed, so a case can read what was sent. */
function stubBoss() {
  return {
    send: vi.fn(async (_queue: string, _payload: Record<string, unknown>) => "job-1"),
  };
}

function contextFor(db: Database): StepContext {
  return { db, boss: stubBoss() as unknown as StepContext["boss"], logger: silentLogger };
}

describe("what a stage records about itself", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_stage_runs");
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

  /** This monitor's rows, oldest first, which is the order they were written. */
  async function runsOf(monitorId: string) {
    return db
      .select()
      .from(stageRuns)
      .where(eq(stageRuns.monitorId, monitorId))
      .orderBy(stageRuns.startedAt);
  }

  async function insertPost(
    post: (typeof fakePosts)[number],
    externalId = post.externalId,
  ): Promise<string> {
    const [row] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId,
        url: post.url,
        author: post.author ?? null,
        channel: post.channel ?? null,
        title: post.title ?? null,
        excerpt: post.text,
        postedAt: post.postedAt,
      })
      .returning({ id: posts.id });

    if (!row) throw new Error("The post was not inserted.");
    return row.id;
  }

  describe("the pre-filter", () => {
    it("writes what it was handed, what it kept, and what each stage dropped", async () => {
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["manually testing signup and checkout"],
        generatedSubreddits: [],
      });
      const kept = await insertPost(strongPost);
      const dropped = await insertPost(offTopicPost);

      await createFilterStep()({ monitorId, postIds: [kept, dropped] }, contextFor(db));

      const [run] = await runsOf(monitorId);

      expect(run?.stage).toBe("filter");
      expect(run?.outcome).toBe("done");
      expect(run?.itemsIn).toBe(2);
      expect(run?.itemsOut).toBe(1);
      expect(run?.detail).toEqual({ stage: "filter", keyword: 1, embedding: 0, triage: 0 });
      expect(run?.userId).toBe("user-1");
    });

    it("writes a row for the run that kept nothing at all", async () => {
      // The run a person needs explained: the classifier was never asked, so
      // there is no model call, no match and no cost to find afterwards.
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["a phrase no post contains"],
        generatedSubreddits: [],
      });
      const postId = await insertPost(offTopicPost);

      await createFilterStep()({ monitorId, postIds: [postId] }, contextFor(db));

      const [run] = await runsOf(monitorId);

      expect(run?.itemsOut).toBe(0);
      expect(run?.detail).toMatchObject({ keyword: 1 });
    });
  });

  describe("the classifier", () => {
    it("writes what it scored, what matched and what it cost", async () => {
      const monitorId = await insertMonitor(database);
      const postId = await insertPost(strongPost);

      await createClassifyStep({ classifierFor: async () => stubClassifier(() => scored) })(
        { monitorId, postIds: [postId] },
        contextFor(db),
      );

      const [run] = await runsOf(monitorId);

      expect(run?.stage).toBe("classify");
      expect(run?.outcome).toBe("done");
      expect(run?.itemsIn).toBe(1);
      expect(run?.itemsOut).toBe(1);
      expect(run?.estimatedCostMicros).toBe(call.estimatedCostMicros);
      expect(run?.detail).toMatchObject({ scored: 1, matched: 1, unclassified: 0, leftByCap: 0 });
    });

    it("says an account with no model refused, rather than leaving an empty inbox", async () => {
      const monitorId = await insertMonitor(database);
      const postId = await insertPost(strongPost);

      await createClassifyStep({ classifierFor: async () => undefined })(
        { monitorId, postIds: [postId] },
        contextFor(db),
      );

      const [run] = await runsOf(monitorId);

      expect(run?.outcome).toBe("refused");
      expect(run?.stopReason).toBe("no_model");
      expect(run?.itemsIn).toBe(1);
      expect(run?.itemsOut).toBe(0);
    });

    it("says the cap stopped it, and how many posts it did not reach", async () => {
      /**
       * BUG-004's shape. The posts it did not reach keep their place and leave
       * no row of their own, so without this line a capped run and a run that
       * found nothing are the same absence.
       */
      const monitorId = await insertMonitor(database);
      const first = await insertPost(strongPost);
      const second = await insertPost(strongPost, "second-post");
      await setBudget(db, monitorId, { monthlyCapMicros: 1, onExhausted: "notify" });

      await createClassifyStep({ classifierFor: async () => stubClassifier(() => scored) })(
        { monitorId, postIds: [first, second] },
        contextFor(db),
      );

      const [run] = await runsOf(monitorId);

      expect(run?.outcome).toBe("refused");
      expect(run?.stopReason).toBe("budget_exhausted");
      expect(run?.detail).toMatchObject({ leftByCap: 1 });
    });

    it("writes its row before it throws, because the retry cannot say this", async () => {
      const monitorId = await insertMonitor(database);
      const postId = await insertPost(strongPost);
      const refused: ClassificationOutcome = {
        status: "failed",
        error: "the provider timed out",
        call,
      };

      await expect(
        createClassifyStep({ classifierFor: async () => stubClassifier(() => refused) })(
          { monitorId, postIds: [postId] },
          contextFor(db),
        ),
      ).rejects.toThrow();

      const [run] = await runsOf(monitorId);

      expect(run?.outcome).toBe("failed");
      expect(run?.stopReason).toBe("error");
      expect(run?.detail).toMatchObject({ unclassified: 1, matched: 0 });
    });
  });

  describe("the replies stage", () => {
    /**
     * The cap, which is the exit worth a row here: the threads a poll found
     * are left unread, no page is bought, and nothing else in the database
     * says the stage ran at all. What the stage does when it *does* buy pages
     * is asserted in `replies.test.ts`, against captured fixtures.
     */
    it("says the cap refused it before any page was bought", async () => {
      const monitorId = await insertMonitor(database, { includeReplies: true });
      const postId = await insertPost(strongPost);
      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "pause" });

      await createRepliesStep({ registry: fakeRegistry(), credentialsFor: () => ({}) })(
        { monitorId, postIds: [postId] },
        contextFor(db),
      );

      const [run] = await runsOf(monitorId);

      expect(run?.stage).toBe("replies");
      expect(run?.outcome).toBe("refused");
      expect(run?.stopReason).toBe("budget_exhausted");
      expect(run?.itemsIn).toBe(1);
    });
  });

  describe("the notifier", () => {
    /** An email channel that accepts everything, so a pass can finish. */
    const transport = { email: async () => {}, webhook: async () => {} };

    /**
     * Immediate email above 70, which is what makes a pass happen now. The
     * digest is daily, so a monitor on the default would plan nothing until
     * tomorrow and the case would be asserting the clock.
     */
    async function configure(monitorId: string): Promise<void> {
      await saveNotificationSettings(
        db,
        monitorId,
        {
          ...notificationDefaults,
          emailEnabled: true,
          emailTo: "owner@example.test",
          immediateScore: 70,
        },
        new Date(Date.now() - 1_000),
      );
    }

    async function matchFor(monitorId: string, postId: string): Promise<void> {
      await db.insert(matches).values({
        monitorId,
        postId,
        score: 90,
        relevance: 90,
        problemFit: 90,
        icpFit: 90,
        intent: 90,
        urgency: 90,
        intentType: "problem",
        reasons: ["A team describes broken tests"],
      });
    }

    it("writes what it planned and what left the building", async () => {
      const monitorId = await insertMonitor(database);
      const postId = await insertPost(strongPost);
      await configure(monitorId);
      await matchFor(monitorId, postId);

      await createNotifyStep(transport)({ monitorId, matchIds: [] }, contextFor(db));

      const [run] = await runsOf(monitorId);

      expect(run?.stage).toBe("notify");
      expect(run?.outcome).toBe("done");
      expect(run?.itemsOut).toBeGreaterThan(0);
      expect(run?.detail).toMatchObject({ stage: "notify" });
    });

    /**
     * The exception to "every run writes a row". `enqueueNotifications` sweeps
     * every monitor with settings on a schedule: the dev instance holds
     * sixteen thousand of those jobs against nine polls, and a row for each
     * would be a history of the sweep rather than of the monitor.
     */
    it("writes nothing for a sweep that had nothing to send", async () => {
      const monitorId = await insertMonitor(database);
      await configure(monitorId);

      await createNotifyStep(transport)({ monitorId, matchIds: [] }, contextFor(db));

      expect(await runsOf(monitorId)).toEqual([]);
    });
  });

  /**
   * The walk, carried from the poll. US-203.
   *
   * Four polls of one paging collection produce four filters, and they
   * interleave: a filter for one poll runs while the next poll is already
   * collecting. Without this the history is eight true lines nobody can pair.
   */
  describe("which collection a stage belonged to", () => {
    it("writes the walk the job carried", async () => {
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["manually testing signup and checkout"],
        generatedSubreddits: [],
      });
      const postId = await insertPost(strongPost);
      const walkId = crypto.randomUUID();

      await createFilterStep()({ monitorId, postIds: [postId], walkId }, contextFor(db));

      expect((await runsOf(monitorId))[0]?.walkId).toBe(walkId);
    });

    it("passes it to the stage it enqueues", async () => {
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["manually testing signup and checkout"],
        generatedSubreddits: [],
      });
      const postId = await insertPost(strongPost);
      const walkId = crypto.randomUUID();
      const boss = stubBoss();

      await createFilterStep()(
        { monitorId, postIds: [postId], walkId },
        { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger },
      );

      // Every job this step sends carries the collection on, so the classify
      // row and the replies row file under the same poll as this one.
      for (const [, payload] of boss.send.mock.calls) {
        expect(payload.walkId).toBe(walkId);
      }
      expect(boss.send.mock.calls.length).toBeGreaterThan(0);
    });

    it("writes null for a job an older worker sent", async () => {
      // A worker that predates this field is still a worker. Its jobs are
      // still work, and a stage that refused to record one would lose the
      // history over a field that is only ever read for grouping.
      const monitorId = await insertMonitor(database, {
        generatedQueries: ["manually testing signup and checkout"],
        generatedSubreddits: [],
      });
      const postId = await insertPost(strongPost);

      await createFilterStep()({ monitorId, postIds: [postId] }, contextFor(db));

      expect((await runsOf(monitorId))[0]?.walkId).toBeNull();
    });
  });

  describe("the table itself", () => {
    it("answers for one monitor, newest first, and only for its owner", async () => {
      const monitorId = await insertMonitor(database);

      for (const stage of ["filter", "classify"] as const) {
        await recordStageRun(db, {
          monitorId,
          userId: "user-1",
          stage,
          startedAt: new Date(stage === "filter" ? Date.now() - 60_000 : Date.now()),
          finishedAt: new Date(),
          outcome: "done",
          itemsIn: 3,
          itemsOut: 2,
        });
      }

      const mine = await readStageRuns(db, "user-1", monitorId);

      expect(mine.map((run) => run.stage)).toEqual(["classify", "filter"]);
      // BUG-009: a read that cannot be performed unscoped cannot be forgotten.
      expect(await readStageRuns(db, "somebody-else", monitorId)).toEqual([]);
    });

    it("keeps a monitor's rows bounded, so the table cannot become the largest", async () => {
      const monitorId = await insertMonitor(database);
      const extra = 3;

      for (let index = 0; index < stageRunsKeptPerMonitor + extra; index++) {
        await recordStageRun(db, {
          monitorId,
          userId: "user-1",
          stage: "notify",
          startedAt: new Date(Date.now() - (stageRunsKeptPerMonitor + extra - index) * 1_000),
          finishedAt: new Date(),
          outcome: "done",
          itemsIn: 1,
          itemsOut: 1,
        });
      }

      expect((await runsOf(monitorId)).length).toBe(stageRunsKeptPerMonitor);
    });
  });
});
