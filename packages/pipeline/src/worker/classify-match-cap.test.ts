/**
 * A cap on the matches one collection makes. US-443.
 *
 * Once a walk has `matchesPerCollection` matches, the classify step reads no
 * more of its posts: they become `match_cap` drops and no model is paid for
 * them. The count is per walk, so every job of one collection shares it and
 * the next collection starts again.
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
import { filterDrops, matches, pollRuns, posts } from "../db/schema.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { createClassifyStep } from "./classify.js";
import { validateMatchCaps } from "./match-cap.js";
import type { StepContext } from "./steps.js";
import { insertMonitor, silentLogger } from "./testing.js";

const strong: Classification = {
  reasons: ["Asks which tool to use", "Small team with the problem"],
  relevance: 95,
  problemFit: 95,
  icpFit: 95,
  intent: 95,
  urgency: 95,
  intentType: "recommendation_request",
};

function passingClassifier() {
  const classify = vi.fn(
    async (): Promise<ClassificationOutcome> => ({
      status: "scored",
      classification: strong,
      score: leadScore(strong),
      removedReasons: [],
      call: { provider: "openai", model: "cheap", latencyMs: 5, estimatedCostMicros: 100 },
    }),
  );
  const classifier: Classifier = { provider: "openai", model: "cheap", classify };
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
  database = await createTestDatabase("worker_classify_match_cap");
  ({ db, close } = createDatabase(database.url));
}, 60_000);

afterAll(async () => {
  await close?.();
  await database?.drop();
});

async function somePosts(n: number): Promise<string[]> {
  const rows = await db
    .insert(posts)
    .values(
      Array.from({ length: n }, (_, i) => ({
        source: "reddit" as const,
        externalId: `t3_${Math.random().toString(36).slice(2)}${i}`,
        url: `https://reddit.com/r/softwaretesting/comments/${i}`,
        excerpt: `Which test runner do small teams use? Asking for the ${i}th time.`,
        postedAt: new Date(),
      })),
    )
    .returning({ id: posts.id });
  return rows.map((row) => row.id);
}

async function postsWithSources(
  rows: readonly { readonly source: "reddit" | "x"; readonly externalId: string }[],
): Promise<string[]> {
  const inserted = await db
    .insert(posts)
    .values(
      rows.map(({ source, externalId }) => ({
        source,
        externalId,
        url: `https://example.test/${externalId}`,
        excerpt: `Which test runner do small teams use? Asking for ${externalId}.`,
        postedAt: new Date(),
      })),
    )
    .returning({ id: posts.id });
  return inserted.map((row) => row.id);
}

/** A monitor with one walk that started a minute ago. */
async function monitorWithWalk() {
  const monitorId = await insertMonitor(database, { minScore: 50 });
  const walkId = crypto.randomUUID();
  await db.insert(pollRuns).values({
    monitorId,
    userId: "user-1",
    walkId,
    outcome: "collected",
    startedAt: new Date(Date.now() - 60_000),
  });
  return { monitorId, walkId };
}

async function outcomeOf(monitorId: string) {
  const made = await db.select().from(matches).where(eq(matches.monitorId, monitorId));
  const capped = await db
    .select()
    .from(filterDrops)
    .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.stage, "match_cap")));
  return { matches: made.length, capped: capped.length };
}

describe("a cap on the matches one collection makes", () => {
  it("stops reading once the collection has its matches", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const cheap = passingClassifier();
    const step = createClassifyStep({
      classifierFor: async () => cheap.classifier,
      firstMatchesPerCollection: 2,
      matchesPerCollection: 2,
    });

    await step({ monitorId, postIds: await somePosts(4), walkId }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 2, capped: 2 });
    expect(cheap.classify).toHaveBeenCalledTimes(2);
  });

  it("scores one post of each platform when the first could fill the cap", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const cheap = passingClassifier();
    const step = createClassifyStep({
      classifierFor: async () => cheap.classifier,
      firstMatchesPerCollection: 2,
      matchesPerCollection: 2,
    });
    const [r1, f1, r2, r3] = (await postsWithSources([
      { source: "reddit", externalId: "r1" },
      { source: "x", externalId: "f1" },
      { source: "reddit", externalId: "r2" },
      { source: "reddit", externalId: "r3" },
    ])) as [string, string, string, string];

    await step({ monitorId, postIds: [r1, f1, r2, r3], walkId }, contextFor(db));

    const made = await db.select().from(matches).where(eq(matches.monitorId, monitorId));
    const capped = await db
      .select()
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.stage, "match_cap")));

    expect(made.map((row) => row.postId).sort()).toEqual([r1, f1].sort());
    expect(capped.map((row) => row.postId).sort()).toEqual([r2, r3].sort());
    expect(cheap.classify).toHaveBeenCalledTimes(2);
  });

  it("counts every job of one collection together", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const step = createClassifyStep({
      classifierFor: async () => passingClassifier().classifier,
      firstMatchesPerCollection: 3,
      matchesPerCollection: 3,
    });

    await step({ monitorId, postIds: await somePosts(2), walkId }, contextFor(db));
    await step({ monitorId, postIds: await somePosts(2), walkId }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 3, capped: 1 });
  });

  it("starts again for the next collection", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const step = createClassifyStep({
      classifierFor: async () => passingClassifier().classifier,
      firstMatchesPerCollection: 1,
      matchesPerCollection: 1,
    });
    await step({ monitorId, postIds: await somePosts(2), walkId }, contextFor(db));

    const next = crypto.randomUUID();
    await db
      .insert(pollRuns)
      .values({ monitorId, userId: "user-1", walkId: next, outcome: "collected" });
    await step({ monitorId, postIds: await somePosts(2), walkId: next }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 2, capped: 2 });
  });

  it("uses the first cap on the first walk and the later cap after it", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const step = createClassifyStep({
      classifierFor: async () => passingClassifier().classifier,
      firstMatchesPerCollection: 2,
      matchesPerCollection: 1,
    });

    await step({ monitorId, postIds: await somePosts(4), walkId }, contextFor(db));

    const next = crypto.randomUUID();
    await db
      .insert(pollRuns)
      .values({ monitorId, userId: "user-1", walkId: next, outcome: "collected" });
    await step({ monitorId, postIds: await somePosts(4), walkId: next }, contextFor(db));

    // Two on the first walk, one on the second, and the rest are capped.
    expect(await outcomeOf(monitorId)).toEqual({ matches: 3, capped: 5 });
  });

  it("leaves a later walk uncapped when only the first cap is set", async () => {
    const { monitorId } = await monitorWithWalk();
    const step = createClassifyStep({
      classifierFor: async () => passingClassifier().classifier,
      firstMatchesPerCollection: 1,
    });

    const next = crypto.randomUUID();
    await db
      .insert(pollRuns)
      .values({ monitorId, userId: "user-1", walkId: next, outcome: "collected" });
    await step({ monitorId, postIds: await somePosts(3), walkId: next }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 3, capped: 0 });
  });

  it("caps the first walk too when only the general cap is set, as before US-490", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const step = createClassifyStep({
      classifierFor: async () => passingClassifier().classifier,
      matchesPerCollection: 1,
    });

    await step({ monitorId, postIds: await somePosts(3), walkId }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 1, capped: 2 });
  });

  it("reads everything with no cap", async () => {
    const { monitorId, walkId } = await monitorWithWalk();
    const step = createClassifyStep({ classifierFor: async () => passingClassifier().classifier });

    await step({ monitorId, postIds: await somePosts(4), walkId }, contextFor(db));

    expect(await outcomeOf(monitorId)).toEqual({ matches: 4, capped: 0 });
  });

  it("refuses a cap below one", () => {
    expect(() =>
      createClassifyStep({
        classifierFor: async () => undefined,
        matchesPerCollection: 0,
      }),
    ).toThrow(RangeError);
  });

  it.each([0, 1.5, -1])("refuses %s for each cap", (value) => {
    expect(() => validateMatchCaps({ firstMatchesPerCollection: value })).toThrow(RangeError);
    expect(() => validateMatchCaps({ matchesPerCollection: value })).toThrow(RangeError);
  });
});
