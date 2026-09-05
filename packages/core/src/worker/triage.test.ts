/**
 * The triage stage, driven the way the worker drives it.
 *
 * **The assertions here were written before the stage was wired in.** Triage
 * decides what the classifier never reads, so its failure shape is a lead
 * deleted before anybody sees it. `ai/triage.test.ts` proves the rule at the
 * unit — only an explicit `no` drops — and this file proves it where the rule
 * is actually used, over real Postgres, because a rule is only as tested as
 * its least-tested caller.
 *
 * The pre-filter has five exits and every one of them must reach this stage.
 * Three of them are asserted below: the ordinary path, a deployment with no
 * embedder, and a monitor that dropped everything earlier. The fourth and
 * fifth are the embedding failures, which `filter.test.ts` already drives.
 *
 * Nothing here reaches a provider. The triager is a stub that answers what
 * each case chose.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelCall } from "../ai/call.js";
import type { Triager, TriageVerdict } from "../ai/triage.js";
import { monitorSpend } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { filterDrops, modelCalls, posts } from "../db/schema.js";
import { filterDropCounts } from "../filter/drops.js";
import { createLogger } from "../logger.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import type { ClassifyPayload } from "./queues.js";
import { filterQueue } from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fakeRegistry, fastRetries, insertMonitor, until } from "./testing.js";

/** "Playwright is awesome" and "Our Playwright tests break…": both pass the keywords. */
const weakPost = fakePosts[0] as (typeof fakePosts)[number];
const brokenTestsPost = fakePosts[1] as (typeof fakePosts)[number];
/** The sourdough post. The keyword stage drops it before triage sees it. */
const unrelatedPost = fakePosts[4] as (typeof fakePosts)[number];

const call: ModelCall = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  inputTokens: 300,
  outputTokens: 6,
  latencyMs: 40,
  estimatedCostMicros: 330,
};

/**
 * What the stub answers next, set per case.
 *
 * A function of the excerpt rather than a queue, so a case says "refuse this
 * post" instead of counting on the order the step happens to read them in.
 */
let answer: (excerpt: string) => TriageVerdict | "unanswered" = () => "yes";
let asked: string[] = [];

const triager: Triager = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  triage: async ({ post }) => {
    asked.push(post.excerpt);
    const verdict = answer(post.excerpt);

    // The shape `ai/triage.ts` returns when the model was not reached or
    // answered badly. `kept` is true, and this file asserts that it stays true.
    if (verdict === "unanswered") {
      return { kept: true, verdict: null, status: "failed", error: "provider unreachable", call };
    }

    return { kept: verdict !== "no", verdict, status: "scored", call };
  },
};

let database: TestDatabase;
let worker: WorkerHandle;
let db: Database;
let closeDb: () => Promise<void>;
const classified: ClassifyPayload[] = [];

async function insertPost(post: (typeof fakePosts)[number], externalId: string): Promise<string> {
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

function insertTriageMonitor(overrides: Record<string, unknown> = {}): Promise<string> {
  return insertMonitor(database, {
    generatedQueries: ["flaky end to end tests", "playwright suite maintenance"],
    generatedSubreddits: ["SaaS"],
    ...overrides,
  });
}

async function filterPosts(monitorId: string, postIds: string[]): Promise<ClassifyPayload> {
  await worker.boss.send(filterQueue, { monitorId, postIds });

  return until("the posts to reach the classify step", () =>
    classified.find((payload) => payload.monitorId === monitorId),
  );
}

beforeAll(async () => {
  database = await createTestDatabase("worker_triage");
  ({ db, close: closeDb } = createDatabase(database.url));

  worker = await startWorker({
    databaseUrl: database.url,
    logger: createLogger({ level: "silent", name: "test" }),
    registry: fakeRegistry(),
    credentialsFor: () => ({ token: "test-token" }),
    // No embedder: this deployment is the common one, and it is also the
    // shape US-029 decided a comment always has. Triage is then the only paid
    // stage in front of the classifier, which is what these cases measure.
    triager,
    steps: {
      classify: async (payload) => {
        classified.push(payload);
      },
    },
    retry: fastRetries,
    scheduleTicks: false,
  });
}, 60_000);

afterAll(async () => {
  await worker?.stop();
  await closeDb?.();
  await database?.drop();
});

beforeEach(() => {
  answer = () => "yes";
  asked = [];
  classified.length = 0;
});

describe("what triage decides", () => {
  it("drops a post the model refuses, and records the drop", async () => {
    const monitorId = await insertTriageMonitor();
    const kept = await insertPost(brokenTestsPost, "t3_keep_1");
    const refused = await insertPost(weakPost, "t3_drop_1");

    answer = (excerpt) => (excerpt === weakPost.text ? "no" : "yes");

    const payload = await filterPosts(monitorId, [kept, refused]);

    expect(payload.postIds).toEqual([kept]);

    const [drop] = await db
      .select()
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.postId, refused)));

    expect(drop?.stage).toBe("triage");
    // Nothing was measured: a model was asked. The keyword stage is null here
    // for the same reason.
    expect(drop?.similarity).toBeNull();
  });

  it.each(["yes", "maybe"] as const)("keeps a post the model answers %s", async (verdict) => {
    const monitorId = await insertTriageMonitor();
    const postId = await insertPost(brokenTestsPost, `t3_keep_${verdict}`);

    answer = () => verdict;

    const payload = await filterPosts(monitorId, [postId]);

    expect(payload.postIds).toEqual([postId]);
  });

  it("counts its drops beside the other stages, so a person can see what it threw away", async () => {
    const monitorId = await insertTriageMonitor();
    const refused = await insertPost(weakPost, "t3_counted");
    const byKeyword = await insertPost(unrelatedPost, "t3_counted_keyword");

    answer = () => "no";

    await filterPosts(monitorId, [refused, byKeyword]);

    const counts = await filterDropCounts(db, [monitorId]);

    expect(counts.get(monitorId)).toEqual({ keyword: 1, embedding: 0, triage: 1 });
  });
});

/**
 * The block that matters. Every case must keep the post.
 *
 * A wrong `yes` costs one classification, on a bill somebody reads. A wrong
 * `no` leaves one `filter_drops` row and nothing else — no match, no inbox
 * entry, nothing anyone would look at. These go red if a later change makes a
 * provider failure drop a post quietly.
 */
describe("a triage call that does not answer keeps the post", () => {
  it("keeps it when the provider could not be reached", async () => {
    const monitorId = await insertTriageMonitor();
    const postId = await insertPost(brokenTestsPost, "t3_unanswered");

    answer = () => "unanswered";

    const payload = await filterPosts(monitorId, [postId]);

    expect(payload.postIds).toEqual([postId]);

    const drops = await db.select().from(filterDrops).where(eq(filterDrops.monitorId, monitorId));

    expect(drops).toEqual([]);
  });

  it("records the failed call anyway, because it was billed either way", async () => {
    const monitorId = await insertTriageMonitor();
    const postId = await insertPost(brokenTestsPost, "t3_unanswered_billed");

    answer = () => "unanswered";

    await filterPosts(monitorId, [postId]);

    const [row] = await db
      .select()
      .from(modelCalls)
      .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.purpose, "triage")));

    expect(row?.outcome).toBe("failed");
    expect(row?.error).toBe("provider unreachable");
    expect(row?.estimatedCostMicros).toBe(330);
  });
});

describe("what the bill can tell apart", () => {
  it("records a triage call under its own purpose, not the classifier's", async () => {
    const monitorId = await insertTriageMonitor();
    const postId = await insertPost(brokenTestsPost, "t3_purpose");

    await filterPosts(monitorId, [postId]);

    const rows = await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.purpose).toBe("triage");
    expect(rows[0]?.postId).toBe(postId);
    expect(rows[0]?.outcome).toBe("scored");
  });

  it("asks once per post, because one post is one question", async () => {
    const monitorId = await insertTriageMonitor();
    const first = await insertPost(brokenTestsPost, "t3_one_each_1");
    const second = await insertPost(weakPost, "t3_one_each_2");

    await filterPosts(monitorId, [first, second]);

    expect(asked).toHaveLength(2);

    const rows = await db
      .select()
      .from(modelCalls)
      .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.purpose, "triage")));

    expect(rows).toHaveLength(2);
  });
});

describe("what a triage call costs the monitor", () => {
  /**
   * US-013's guard adds up `model_calls` without asking what each one was for,
   * so a third kind of call reaches the cap by existing. That is the right
   * design and it is also the easy one to break: a later `where purpose =
   * 'classification'` would leave this stage spending outside the cap, at
   * 02:00, silently. This is the assertion that would go red.
   */
  it("counts against the monitor's cap like any other model call", async () => {
    const monitorId = await insertTriageMonitor();
    const first = await insertPost(brokenTestsPost, "t3_spend_1");
    const second = await insertPost(weakPost, "t3_spend_2");

    // Both refused, so neither reaches the classifier and every micro-dollar
    // the monitor spent this month is triage's.
    answer = () => "no";

    await filterPosts(monitorId, [first, second]);

    const spend = await until("the spend to be readable", async () => {
      const reading = await monitorSpend(db, monitorId);
      return reading.modelMicros > 0 ? reading : undefined;
    });

    expect(spend.modelMicros).toBe(660);
    expect(spend.totalMicros).toBe(660);
  });
});

describe("what triage is never asked about", () => {
  it("does not pay to read a post the free keyword stage already dropped", async () => {
    const monitorId = await insertTriageMonitor();
    const postId = await insertPost(unrelatedPost, "t3_never_asked");

    const payload = await filterPosts(monitorId, [postId]);

    expect(payload.postIds).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("does not run at all for a monitor whose pre-filter is off", async () => {
    // Triage is one of the pre-filter's stages. A person who turned the filter
    // off turned this off too; deciding otherwise would be this product
    // choosing which of the three stages counts as filtering.
    const monitorId = await insertTriageMonitor({ preFilterEnabled: false });
    const postId = await insertPost(unrelatedPost, "t3_filter_off");

    answer = () => "no";

    const payload = await filterPosts(monitorId, [postId]);

    expect(payload.postIds).toEqual([postId]);
    expect(asked).toEqual([]);
  });
});
