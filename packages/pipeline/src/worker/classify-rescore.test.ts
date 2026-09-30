/**
 * A second model for the posts the first one passes. US-441.
 *
 * The classifier reads every post, so it is the cheap model. With a rescorer,
 * a post it scores at or above the bar is read again, and the match takes the
 * second answer. These are the four claims: the second score is the match's,
 * a second score below the bar writes no match, a second call that fails
 * leaves the first answer standing, and a post below the bar is never read
 * twice.
 */
import {
  type Classification,
  type ClassificationOutcome,
  type Classifier,
  leadScore,
} from "@signalscout/engine";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { matches, modelCalls, pollRuns, posts } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import type { StepContext } from "./steps.js";
import { insertMonitor, silentLogger } from "./testing.js";

function answer(level: number): Classification {
  return {
    reasons: ["Asks which tool to use", "Small team with the problem"],
    relevance: level,
    problemFit: level,
    icpFit: level,
    intent: level,
    urgency: level,
    intentType: "recommendation_request",
  };
}

/** A classifier that gives every post the same answer, and counts its calls. */
function fixedClassifier(model: string, result: "fail" | number) {
  const classify = vi.fn(async (): Promise<ClassificationOutcome> => {
    const call = { provider: "openai" as const, model, latencyMs: 5, estimatedCostMicros: 100 };
    if (result === "fail") return { status: "failed", error: "the provider timed out", call };
    const classification = answer(result);
    return {
      status: "scored",
      classification,
      score: leadScore(classification),
      removedReasons: [],
      call,
    };
  });
  const classifier: Classifier = { provider: "openai", model, classify };
  return { classifier, classify };
}

function contextFor(db: Database): StepContext {
  const boss = { send: vi.fn(async () => "job-1") };
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  database = await createTestDatabase("worker_classify_rescore");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

async function onePost(): Promise<string> {
  const [row] = await db
    .insert(posts)
    .values({
      source: "reddit",
      externalId: `t3_${Math.random().toString(36).slice(2)}`,
      url: "https://reddit.com/r/softwaretesting/comments/1",
      excerpt: "Which test runner do small teams use for flaky end-to-end tests?",
      postedAt: new Date(),
    })
    .returning({ id: posts.id });
  if (!row) throw new Error("The post was not inserted.");
  return row.id;
}

async function run(first: "fail" | number, second?: "fail" | number) {
  const monitorId = await insertMonitor(database, { minScore: 50 });
  const postId = await onePost();
  const cheap = fixedClassifier("cheap", first);
  const strong = second === undefined ? undefined : fixedClassifier("strong", second);
  const step = createClassifyStep({
    classifierFor: async () => cheap.classifier,
    ...(strong ? { rescorerFor: async () => strong.classifier } : {}),
  });
  await step({ monitorId, postIds: [postId] }, contextFor(db));

  const [match] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.monitorId, monitorId), eq(matches.postId, postId)));
  const calls = await db
    .select({ purpose: modelCalls.purpose, model: modelCalls.model, outcome: modelCalls.outcome })
    .from(modelCalls)
    .where(eq(modelCalls.monitorId, monitorId));
  return { match, calls, strong };
}

describe("a second model for the posts the first one passes", () => {
  it("writes the match with the second model's score", async () => {
    const { match, calls } = await run(70, 95);

    expect(match?.score).toBe(leadScore(answer(95)));
    expect(calls).toEqual(
      expect.arrayContaining([
        { purpose: "classification", model: "cheap", outcome: "scored" },
        { purpose: "rescore", model: "strong", outcome: "scored" },
      ]),
    );
    expect(calls).toHaveLength(2);
  });

  it("writes no match when the second score is below the bar", async () => {
    const { match, calls } = await run(70, 20);

    expect(match).toBeUndefined();
    // Still one classification: the post is scored and never asked again.
    expect(calls.filter((call) => call.purpose === "classification")).toHaveLength(1);
    expect(calls.filter((call) => call.purpose === "rescore")).toHaveLength(1);
  });

  it("keeps the first score when the second call fails", async () => {
    const { match, calls } = await run(70, "fail");

    expect(match?.score).toBe(leadScore(answer(70)));
    expect(calls).toEqual(
      expect.arrayContaining([{ purpose: "rescore", model: "strong", outcome: "failed" }]),
    );
  });

  it("does not read a post twice when the first score is below the bar", async () => {
    const { match, calls, strong } = await run(20, 95);

    expect(match).toBeUndefined();
    expect(strong?.classify).not.toHaveBeenCalled();
    expect(calls).toEqual([{ purpose: "classification", model: "cheap", outcome: "scored" }]);
  });

  it("scores as before with no second model", async () => {
    const { match, calls } = await run(70);

    expect(match?.score).toBe(leadScore(answer(70)));
    expect(calls).toEqual([{ purpose: "classification", model: "cheap", outcome: "scored" }]);
  });
});

describe("a rescorer for the first collection only", () => {
  /** Two collections on one monitor: the first a day before the second. */
  async function twoWalks() {
    const monitorId = await insertMonitor(database, { minScore: 50 });
    const first = crypto.randomUUID();
    const later = crypto.randomUUID();
    await db.insert(pollRuns).values([
      {
        monitorId,
        userId: "user-1",
        walkId: first,
        outcome: "collected",
        startedAt: new Date(Date.now() - 86_400_000),
      },
      { monitorId, userId: "user-1", walkId: later, outcome: "collected" },
    ]);
    return { monitorId, first, later };
  }

  async function classifyIn(monitorId: string, walkId: string | undefined) {
    const postId = await onePost();
    const strong = fixedClassifier("strong", 95);
    const step = createClassifyStep({
      classifierFor: async () => fixedClassifier("cheap", 70).classifier,
      rescorerFor: async () => strong.classifier,
      rescorePolls: "first",
    });
    await step({ monitorId, postIds: [postId], ...(walkId ? { walkId } : {}) }, contextFor(db));
    const [match] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.monitorId, monitorId), eq(matches.postId, postId)));
    return { score: match?.score, rescored: strong.classify.mock.calls.length };
  }

  it("rescores the posts of the monitor's first walk", async () => {
    const { monitorId, first } = await twoWalks();

    expect(await classifyIn(monitorId, first)).toEqual({
      score: leadScore(answer(95)),
      rescored: 1,
    });
  });

  it("keeps the first model's score on a later walk", async () => {
    const { monitorId, later } = await twoWalks();

    expect(await classifyIn(monitorId, later)).toEqual({
      score: leadScore(answer(70)),
      rescored: 0,
    });
  });

  it("keeps the first model's score on a job with no walk", async () => {
    const { monitorId } = await twoWalks();

    expect(await classifyIn(monitorId, undefined)).toEqual({
      score: leadScore(answer(70)),
      rescored: 0,
    });
  });
});
