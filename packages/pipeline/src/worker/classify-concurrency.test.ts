/**
 * Scoring a few posts at once. US-438.
 *
 * The classify step scores one post after another by default, and that stays
 * the default. An application may ask for a few calls in flight; the rules
 * the one-at-a-time loop keeps must still hold: the posts start in the order
 * they were handed, a copy of a post waits for the post it copies, and the
 * monitor's cap is not crossed by more than it is today.
 */
import { type AiConfig, createClassifier } from "@signalscout/engine";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { matches, modelCalls, posts } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import type { StepContext } from "./steps.js";
import { insertMonitor, silentLogger } from "./testing.js";

const aiConfig: AiConfig = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  apiKey: "test-key",
  timeoutMs: 5_000,
};

const strongAnswer = JSON.stringify({
  reasons: [
    "Four-person SaaS team with no dedicated QA",
    "Manually tests signup and checkout every release",
    "Asks what tools other small teams use",
  ],
  relevance: 98,
  problemFit: 96,
  icpFit: 91,
  intent: 88,
  urgency: 82,
  intentType: "recommendation_request",
});

/** A model that answers after a pause, and counts how many calls overlap. */
function slowModel() {
  let inFlight = 0;
  let most = 0;
  let calls = 0;
  const model = new MockLanguageModelV4({
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => {
      calls += 1;
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return {
        content: [{ type: "text" as const, text: strongAnswer }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 120, text: 120, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, most: () => most, calls: () => calls };
}

function stubBoss() {
  return { send: vi.fn(async () => "job-1") };
}

function contextFor(db: Database): StepContext {
  return { db, boss: stubBoss() as unknown as StepContext["boss"], logger: silentLogger };
}

let database: TestDatabase;
let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  database = await createTestDatabase("worker_classify_concurrency");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

async function insertPosts(count: number, overrides: { author?: string; text?: string } = {}) {
  const rows = await db
    .insert(posts)
    .values(
      Array.from({ length: count }, (_, index) => ({
        source: "reddit" as const,
        externalId: `concurrency-${crypto.randomUUID()}`,
        url: `https://example.test/concurrency/${index}`,
        author: overrides.author ?? `author-${crypto.randomUUID()}`,
        channel: "QualityAssurance",
        title: "What do small teams use for end-to-end tests?",
        excerpt:
          overrides.text ??
          `We manually test signup and checkout before every release, post ${index}`,
        postedAt: new Date(Date.now() - 3_600_000),
      })),
    )
    .returning({ id: posts.id });
  return rows.map((row) => row.id);
}

async function run(concurrency: number | undefined, monitorId: string, postIds: string[]) {
  const slow = slowModel();
  const classifier = createClassifier({ config: aiConfig, model: slow.model });
  const step = createClassifyStep({
    classifierFor: async () => classifier,
    ...(concurrency === undefined ? {} : { concurrency }),
  });
  await step({ monitorId, postIds }, contextFor(db));
  return slow;
}

describe("scoring several posts at once (US-438)", () => {
  it("scores one post at a time by default", async () => {
    const monitorId = await insertMonitor(database);
    const slow = await run(undefined, monitorId, await insertPosts(4));
    expect(slow.most()).toBe(1);
    expect(slow.calls()).toBe(4);
  });

  it("keeps up to the asked number of calls in flight, and scores every post", async () => {
    const monitorId = await insertMonitor(database);
    const slow = await run(4, monitorId, await insertPosts(9));
    expect(slow.most()).toBe(4);
    expect(slow.calls()).toBe(9);
    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(9);
  });

  it("makes a copy of a post wait for it, so the copy is still carried rather than scored", async () => {
    const monitorId = await insertMonitor(database);
    const text = "Our end-to-end tests break every release and nobody owns them.";
    const copiesOfOne = await insertPosts(2, { author: "same-author", text });
    const slow = await run(4, monitorId, [...copiesOfOne, ...(await insertPosts(2))]);
    // Three calls: the post, and the two others. The copy is carried by the card.
    expect(slow.calls()).toBe(3);
  });

  it("does not spend past the cap more than one call at a time does", async () => {
    const budget = { monthlyCapMicros: 2_500, onExhausted: "pause" as const };
    const one = await insertMonitor(database);
    const four = await insertMonitor(database);
    await setBudget(db, one, budget);
    await setBudget(db, four, budget);

    const alone = await run(1, one, await insertPosts(12));
    const together = await run(4, four, await insertPosts(12));

    const spent = async (monitorId: string) =>
      (await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId))).length;
    expect(alone.calls()).toBeGreaterThan(0);
    expect(alone.calls()).toBeLessThan(12);
    expect(together.calls()).toBeLessThanOrEqual(alone.calls());
    expect(await spent(four)).toBe(together.calls());
  });

  it("refuses a count below 1 or above the ceiling", () => {
    const classifierFor = async () => undefined;
    expect(() => createClassifyStep({ classifierFor, concurrency: 0 })).toThrow(RangeError);
    expect(() => createClassifyStep({ classifierFor, concurrency: 17 })).toThrow(RangeError);
  });
});
