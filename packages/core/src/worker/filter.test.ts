/**
 * The pre-filter, driven the way the worker drives it.
 *
 * Two things here need real Postgres and get it. The similarity is measured by
 * `pgvector` and not by this test, so the distance operator is exercised
 * rather than described — docs/testing.md names pgvector distance as one of
 * the two things an in-memory fake gets wrong. And the drops are rows, so
 * "what did this stage do last week" is asserted from where a person would
 * read it.
 *
 * The embedder is the real one over a stub model, for `call.ts`'s reason: the
 * seam between them holds a narrow catch, and a catch tested only through its
 * own unit is a catch nobody has watched fail where it matters. The stub
 * answers with vectors this file chose, so every expected similarity below is
 * a number a person can check against the input.
 *
 * Nothing here reaches a provider. `vitest.config.ts` blanks AI_API_KEY, and
 * the model is passed in.
 */

import { APICallError } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingConfig } from "../ai/config.js";
import { createEmbedder } from "../ai/embed.js";
import { monitorSpend } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import { embeddingDimensions, filterDrops, modelCalls, monitors, posts } from "../db/schema.js";
import { filterDropCounts } from "../filter/drops.js";
import { createLogger } from "../logger.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import type { ClassifyPayload } from "./queues.js";
import { filterQueue } from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fakeRegistry, fastRetries, insertMonitor, silentLogger, until } from "./testing.js";

/**
 * A unit vector whose cosine similarity with the monitor's own vector is
 * exactly `similarity`.
 *
 * The monitor is `[1, 0, 0, …]`, so a post at `[s, √(1 - s²), 0, …]` has
 * cosine similarity `s` with it, and every expected number in this file is the
 * number the test asked for. pgvector still does the measuring.
 */
function vectorFor(similarity: number): number[] {
  const embedding = new Array<number>(embeddingDimensions).fill(0);
  embedding[0] = similarity;
  embedding[1] = Math.sqrt(1 - similarity ** 2);
  return embedding;
}

/** "Playwright is awesome": PLAN.md's weakest example. Passes the keywords. */
const weakPost = fakePosts[0] as (typeof fakePosts)[number];
/** "Our Playwright tests break whenever the UI changes." */
const brokenTestsPost = fakePosts[1] as (typeof fakePosts)[number];
/** The four-person SaaS asking what other teams use. */
const strongPost = fakePosts[3] as (typeof fakePosts)[number];
/** The sourdough post: nothing in it matches anything the monitor looks for. */
const sourdoughPost = fakePosts[4] as (typeof fakePosts)[number];

/**
 * How near each post is to the monitor, as the stub model answers.
 *
 * A person can read the post and agree with the number: the four-person SaaS
 * is asking the monitor's question, and "Playwright is awesome" mentions the
 * same tool while saying nothing the monitor is looking for.
 */
const similarities: Record<string, number> = {
  [weakPost.text]: 0.05,
  [brokenTestsPost.text]: 0.62,
  [strongPost.text]: 0.71,
  [sourdoughPost.text]: 0.01,
};

const embeddingConfig: EmbeddingConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "test-key",
  timeoutMs: 5_000,
  // $0.02 per million tokens, in micro-dollars. A price the deployment set;
  // we carry no table of them.
  pricePerMillionTokensMicros: 20_000,
};

/** Set by a test to make the next call fail the way a provider fails. */
let failWith: Error | undefined;
/** Every batch the stub was asked for, in order. */
let batches: string[][] = [];
/** What the stub returns per value. A test overrides it to break the width. */
let embeddingFor: (value: string) => number[] = (value) =>
  value.startsWith("Product:") ? vectorFor(1) : vectorFor(similarities[postTextOf(value)] ?? 0);

/** The stub is given title and excerpt; the table above is keyed by excerpt. */
function postTextOf(value: string): string {
  const parts = value.split("\n\n");
  return parts[parts.length - 1] ?? value;
}

const model = new MockEmbeddingModelV4({
  provider: "test",
  modelId: "test-embedding",
  maxEmbeddingsPerCall: 100,
  doEmbed: async ({ values }) => {
    batches.push([...values]);
    if (failWith) throw failWith;

    return {
      embeddings: values.map((value) => embeddingFor(value)),
      // A hundred tokens a value, which is about what a short post costs, and
      // a round number the arithmetic below can be checked against.
      usage: { tokens: values.length * 100 },
      warnings: [],
    };
  },
});

let database: TestDatabase;
let worker: WorkerHandle;
let db: Database;
let closeDb: () => Promise<void>;
const classified: ClassifyPayload[] = [];
const lines: Array<Record<string, unknown>> = [];

async function insertPost(
  post: (typeof fakePosts)[number],
  externalId: string,
  source: "reddit" | "x" = "reddit",
): Promise<string> {
  const [row] = await db
    .insert(posts)
    .values({
      source,
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

/**
 * The monitor these cases use.
 *
 * Its queries name Playwright on purpose. "Playwright is awesome" has to reach
 * the second stage for the second stage to be what drops it; a post the
 * keyword stage had already dropped would prove nothing about a threshold.
 */
function insertFilterMonitor(
  target: TestDatabase,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return insertMonitor(target, {
    generatedQueries: ["flaky end to end tests", "playwright suite maintenance"],
    generatedSubreddits: ["SaaS"],
    ...overrides,
  });
}

/** Run one filter job for these posts and wait for what reached the model. */
async function filterPosts(monitorId: string, postIds: string[]): Promise<ClassifyPayload> {
  await worker.boss.send(filterQueue, { monitorId, postIds });

  return until("the posts to reach the classify step", () =>
    classified.find((payload) => payload.monitorId === monitorId),
  );
}

beforeAll(async () => {
  database = await createTestDatabase("worker_filter");
  ({ db, close: closeDb } = createDatabase(database.url));

  const logger = createLogger({
    level: "info",
    name: "test",
    destination: {
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  });

  worker = await startWorker({
    databaseUrl: database.url,
    logger,
    registry: fakeRegistry(),
    credentialsFor: () => ({ token: "test-token" }),
    // The real embedder over a stub model: the seam between them is where a
    // bug could be reported as a handled provider failure.
    embedder: createEmbedder({ config: embeddingConfig, model }),
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
  failWith = undefined;
  batches = [];
  embeddingFor = (value) =>
    value.startsWith("Product:") ? vectorFor(1) : vectorFor(similarities[postTextOf(value)] ?? 0);
  classified.length = 0;
  lines.length = 0;
});

describe("the keyword stage", () => {
  it("drops a post that shares nothing with the monitor, and records it", async () => {
    const monitorId = await insertFilterMonitor(database);
    const sourdoughId = await insertPost(sourdoughPost, "keyword-sourdough");
    const testsId = await insertPost(brokenTestsPost, "keyword-tests");

    const reached = await filterPosts(monitorId, [sourdoughId, testsId]);

    expect(reached.postIds).toEqual([testsId]);

    const [drop] = await db
      .select()
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.postId, sourdoughId)));

    expect(drop?.stage).toBe("keyword");
    // Nothing was embedded, so nothing was measured. A zero here would read as
    // a similarity somebody computed.
    expect(drop?.similarity).toBeNull();
  }, 30_000);

  it("does not pay to embed the post it dropped", async () => {
    const monitorId = await insertFilterMonitor(database);
    const sourdoughId = await insertPost(sourdoughPost, "keyword-cost-sourdough");
    const testsId = await insertPost(brokenTestsPost, "keyword-cost-tests");

    await filterPosts(monitorId, [sourdoughId, testsId]);

    const embedded = batches.flat();
    expect(embedded).not.toContain(sourdoughPost.text);
  }, 30_000);
});

describe("a post is checked against its own platform's queries", () => {
  /**
   * US-027. A monitor holds one list of queries per platform, because the same
   * phrase does not work in two places: US-006 measured a six-word Reddit
   * phrase returning nothing on X, and two words returning twenty posts that
   * were all on topic.
   *
   * The pre-filter is where that becomes money. A post checked against the
   * wrong platform's words is either dropped for missing words nobody asked
   * its platform for, or kept and sent to the model at full price.
   */
  const perPlatform = {
    reddit: ["flaky end to end tests", "playwright suite maintenance"],
    x: ["sourdough starter"],
  };

  it("keeps an X post its own list matches, and drops the one only Reddit asked for", async () => {
    const monitorId = await insertFilterMonitor(database, {
      generatedQueries: perPlatform,
      generatedSubreddits: [],
      preFilterEnabled: true,
      // The keyword stage is what these cases are about, so the stage after it
      // is opened wide: a post dropped for being far from the monitor would
      // look exactly like a post the keyword rule refused.
      similarityThreshold: 0,
    });

    // The words are crossed on purpose: the sourdough post is what the X list
    // asks for, and the broken-tests post is what the Reddit list asks for.
    // Both arrive as X posts, so only the X list may decide.
    const sourdoughId = await insertPost(sourdoughPost, "platform-x-sourdough", "x");
    const testsId = await insertPost(brokenTestsPost, "platform-x-tests", "x");

    const reached = await filterPosts(monitorId, [sourdoughId, testsId]);

    expect(reached.postIds).toEqual([sourdoughId]);
  }, 30_000);

  it("uses the Reddit list for a Reddit post in the same monitor", async () => {
    const monitorId = await insertFilterMonitor(database, {
      generatedQueries: perPlatform,
      generatedSubreddits: [],
      preFilterEnabled: true,
      // The keyword stage is what these cases are about, so the stage after it
      // is opened wide: a post dropped for being far from the monitor would
      // look exactly like a post the keyword rule refused.
      similarityThreshold: 0,
    });

    const sourdoughId = await insertPost(sourdoughPost, "platform-reddit-sourdough", "reddit");
    const testsId = await insertPost(brokenTestsPost, "platform-reddit-tests", "reddit");

    const reached = await filterPosts(monitorId, [sourdoughId, testsId]);

    expect(reached.postIds).toEqual([testsId]);
  }, 30_000);

  it("still filters a monitor whose queries were written before the split", async () => {
    // Migration 0021 keys a row by the platforms its monitor watches, and a
    // monitor that names none keeps its array. Such a row must go on polling
    // rather than silently matching nothing.
    const monitorId = await insertFilterMonitor(database, {
      generatedQueries: ["flaky end to end tests", "playwright suite maintenance"],
      generatedSubreddits: [],
      preFilterEnabled: true,
      similarityThreshold: 0,
    });

    const sourdoughId = await insertPost(sourdoughPost, "legacy-shape-sourdough", "x");
    const testsId = await insertPost(brokenTestsPost, "legacy-shape-tests", "x");

    const reached = await filterPosts(monitorId, [sourdoughId, testsId]);

    expect(reached.postIds).toEqual([testsId]);
  }, 30_000);
});

describe("the embedding stage", () => {
  it("drops a post below the monitor's threshold and keeps one above it", async () => {
    const monitorId = await insertFilterMonitor(database);
    const weakId = await insertPost(weakPost, "similarity-weak");
    const strongId = await insertPost(strongPost, "similarity-strong");

    const reached = await filterPosts(monitorId, [weakId, strongId]);

    // "Playwright is awesome" mentions the tool and asks nothing. It survived
    // the keyword stage and the similarity is what stopped it.
    expect(reached.postIds).toEqual([strongId]);

    const [drop] = await db
      .select()
      .from(filterDrops)
      .where(and(eq(filterDrops.monitorId, monitorId), eq(filterDrops.postId, weakId)));

    expect(drop?.stage).toBe("embedding");
    // Measured by pgvector, against the vectors the stub returned.
    expect(drop?.similarity).toBeCloseTo(0.05, 5);
  }, 30_000);

  it("keeps a post the threshold was lowered for", async () => {
    // The same post and the same vectors, and only the monitor's number
    // differs. A threshold that did nothing would pass the case above and fail
    // this one.
    const monitorId = await insertFilterMonitor(database, { similarityThreshold: 0.01 });
    const weakId = await insertPost(weakPost, "threshold-weak");

    const reached = await filterPosts(monitorId, [weakId]);

    expect(reached.postIds).toEqual([weakId]);
    expect(await filterDropCounts(db, [monitorId])).toEqual(new Map());
  }, 30_000);

  it("stores each post's embedding, and never pays for it twice", async () => {
    const monitorId = await insertFilterMonitor(database);
    const strongId = await insertPost(strongPost, "reuse-strong");

    await filterPosts(monitorId, [strongId]);

    const [row] = await db
      .select({ embedding: posts.embedding })
      .from(posts)
      .where(eq(posts.id, strongId));

    expect(row?.embedding).toHaveLength(embeddingDimensions);

    batches = [];
    classified.length = 0;

    await filterPosts(monitorId, [strongId]);

    // The monitor's own vector was stored too, so the second poll embeds
    // nothing at all.
    expect(batches).toEqual([]);
  }, 30_000);

  it("embeds the monitor again after somebody edits it", async () => {
    const monitorId = await insertFilterMonitor(database);
    const strongId = await insertPost(strongPost, "edit-strong");

    await filterPosts(monitorId, [strongId]);

    batches = [];
    classified.length = 0;

    await db
      .update(monitors)
      .set({ problem: "End-to-end tests break whenever the checkout page changes" })
      .where(eq(monitors.id, monitorId));

    await filterPosts(monitorId, [strongId]);

    // One batch, holding the monitor's new description and no post: an old
    // vector of new answers is a filter matching the wrong thing.
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toContain("checkout page changes");
  }, 30_000);
});

describe("what the embedding cost", () => {
  it("is recorded against the monitor as an embedding call", async () => {
    const monitorId = await insertFilterMonitor(database);
    const strongId = await insertPost(strongPost, "cost-strong");

    await filterPosts(monitorId, [strongId]);

    const calls = await until("the embedding calls to be recorded", async () => {
      const rows = await db
        .select()
        .from(modelCalls)
        .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.purpose, "embedding")));

      return rows.length === 2 ? rows : undefined;
    });

    for (const call of calls) {
      expect(call.provider).toBe("openai");
      expect(call.model).toBe("text-embedding-3-small");
      expect(call.outcome).toBe("scored");
      // One value in each batch, a hundred tokens each.
      expect(call.inputTokens).toBe(100);
      // An embedding produces no output tokens. A zero would read as a count.
      expect(call.outputTokens).toBeNull();
      // 100 tokens at $0.02 per million dollars is $0.000002, which is 2
      // micro-dollars. A cents column would have recorded this as nothing.
      expect(call.estimatedCostMicros).toBe(2);
      // The call is about the whole batch, so it is on no single post.
      expect(call.postId).toBeNull();
    }
  }, 30_000);

  it("lands in the monitor's spend, where the budget guard reads it", async () => {
    // US-013's last acceptance box: the total is the true total only when the
    // embeddings are in it. A price that made every embedding cost nothing
    // would pass the assertion above and fail this one.
    const monitorId = await insertFilterMonitor(database);
    const strongId = await insertPost(strongPost, "spend-strong");

    embeddingFor = (value) => (value.startsWith("Product:") ? vectorFor(1) : vectorFor(0.9));

    await filterPosts(monitorId, [strongId]);

    const spend = await until("the embedding spend to be counted", async () => {
      const reading = await monitorSpend(db, monitorId);
      return reading.modelMicros > 0 ? reading : undefined;
    });

    // Two calls — the monitor's description and the post — at 100 tokens and
    // 2 micro-dollars each.
    expect(spend.modelMicros).toBe(4);
    expect(spend.totalMicros).toBe(spend.sourceMicros + spend.modelMicros);
  }, 30_000);
});

/**
 * The swallow docs/testing.md asks for a test of.
 *
 * An embedding failure must send the post to the model, not drop it. These
 * cases go red if the swallow ever starts dropping: the post has to arrive at
 * the classify step, and the failure has to be on the bill and in the log.
 */
describe("an embedding that fails", () => {
  it("sends the post to the model instead of dropping it", async () => {
    const monitorId = await insertFilterMonitor(database);
    const weakId = await insertPost(weakPost, "failure-weak");

    failWith = new APICallError({
      message: "the embedding provider is down",
      url: "https://api.test/embeddings",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });

    const reached = await filterPosts(monitorId, [weakId]);

    // The similarity would have dropped this post at 0.05. It is kept because
    // nothing measured it: a dropped good lead is invisible and an extra
    // classification is only a cost.
    expect(reached.postIds).toEqual([weakId]);

    const drops = await db.select().from(filterDrops).where(eq(filterDrops.monitorId, monitorId));
    expect(drops).toEqual([]);
  }, 30_000);

  it("sends the post on when the posts fail but the monitor was already embedded", async () => {
    // The other branch. The monitor's vector is stored by the first job, so
    // the second job fails on the batch of posts instead — and a mutation that
    // dropped them there would pass the case above and this is what catches
    // it.
    const monitorId = await insertFilterMonitor(database);
    const strongId = await insertPost(strongPost, "failure-posts-first");

    await filterPosts(monitorId, [strongId]);

    classified.length = 0;
    const weakId = await insertPost(weakPost, "failure-posts-second");

    failWith = new APICallError({
      message: "the embedding provider is down",
      url: "https://api.test/embeddings",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });

    const reached = await filterPosts(monitorId, [weakId]);

    expect(reached.postIds).toEqual([weakId]);
  }, 30_000);

  it("is recorded and logged rather than swallowed silently", async () => {
    const monitorId = await insertFilterMonitor(database);
    const weakId = await insertPost(weakPost, "failure-recorded");

    failWith = new APICallError({
      message: "the embedding provider is down",
      url: "https://api.test/embeddings",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });

    await filterPosts(monitorId, [weakId]);

    const [call] = await until("the failed call to be recorded", async () => {
      const rows = await db
        .select()
        .from(modelCalls)
        .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.purpose, "embedding")));

      return rows.length > 0 ? rows : undefined;
    });

    expect(call?.outcome).toBe("failed");
    expect(call?.error).toContain("the embedding provider is down");
    expect(
      lines.some((line) => line.level === 50 && String(line.msg).includes("could not be embedded")),
    ).toBe(true);
  }, 30_000);

  it("keeps the post when the model answers with the wrong number of dimensions", async () => {
    const monitorId = await insertFilterMonitor(database);
    const weakId = await insertPost(weakPost, "failure-width");

    // Google's text-embedding-004 returns 768 numbers. The column stores 1536,
    // so this is a real deployment mistake and not an invented one.
    embeddingFor = () => new Array<number>(768).fill(0.1);

    const reached = await filterPosts(monitorId, [weakId]);

    expect(reached.postIds).toEqual([weakId]);
  }, 30_000);
});

describe("a monitor with the pre-filter turned off", () => {
  it("sends every collected post to the model, and embeds nothing", async () => {
    const monitorId = await insertFilterMonitor(database, { preFilterEnabled: false });
    const sourdoughId = await insertPost(sourdoughPost, "off-sourdough");
    const weakId = await insertPost(weakPost, "off-weak");

    const reached = await filterPosts(monitorId, [sourdoughId, weakId]);

    // Both stages would have dropped one each. Off means off.
    expect([...reached.postIds].sort()).toEqual([sourdoughId, weakId].sort());
    expect(batches).toEqual([]);
    expect(await db.select().from(filterDrops).where(eq(filterDrops.monitorId, monitorId))).toEqual(
      [],
    );
  }, 30_000);
});

describe("the counter on the monitor list", () => {
  it("counts posts, not polls", async () => {
    const monitorId = await insertFilterMonitor(database);
    const sourdoughId = await insertPost(sourdoughPost, "counter-sourdough");
    const weakId = await insertPost(weakPost, "counter-weak");
    const strongId = await insertPost(strongPost, "counter-strong");

    await filterPosts(monitorId, [sourdoughId, weakId, strongId]);

    classified.length = 0;
    // The same posts again, the way a source returns what it returned before.
    await filterPosts(monitorId, [sourdoughId, weakId, strongId]);

    expect(await filterDropCounts(db, [monitorId])).toEqual(
      // `triage` joined the counts in US-030. This worker has no triager, so
      // the stage never ran and its count is zero rather than absent.
      new Map([[monitorId, { keyword: 1, embedding: 1, triage: 0 }]]),
    );
  }, 30_000);
});

/**
 * A deployment with no embedding model at all, which is what Anthropic users
 * get: it has no embedding endpoint and it is our default provider.
 */
describe("a deployment with no embedder", () => {
  let plainDatabase: TestDatabase;
  let plainWorker: WorkerHandle;
  let plainDb: Database;
  let closePlainDb: () => Promise<void>;
  const plainClassified: ClassifyPayload[] = [];

  beforeAll(async () => {
    plainDatabase = await createTestDatabase("worker_filter_no_embedder");
    ({ db: plainDb, close: closePlainDb } = createDatabase(plainDatabase.url));

    plainWorker = await startWorker({
      databaseUrl: plainDatabase.url,
      logger: silentLogger,
      registry: fakeRegistry(),
      credentialsFor: () => ({ token: "test-token" }),
      steps: {
        classify: async (payload) => {
          plainClassified.push(payload);
        },
      },
      retry: fastRetries,
      scheduleTicks: false,
    });
  }, 60_000);

  afterAll(async () => {
    await plainWorker?.stop();
    await closePlainDb?.();
    await plainDatabase?.drop();
  });

  it("still runs the free stage and sends the rest to the model", async () => {
    const monitorId = await insertFilterMonitor(plainDatabase);

    const [sourdoughRow] = await plainDb
      .insert(posts)
      .values({
        source: "reddit",
        externalId: "no-embedder-sourdough",
        url: sourdoughPost.url,
        channel: sourdoughPost.channel ?? null,
        title: sourdoughPost.title ?? null,
        excerpt: sourdoughPost.text,
        postedAt: sourdoughPost.postedAt,
      })
      .returning({ id: posts.id });

    const [weakRow] = await plainDb
      .insert(posts)
      .values({
        source: "reddit",
        externalId: "no-embedder-weak",
        url: weakPost.url,
        channel: weakPost.channel ?? null,
        title: weakPost.title ?? null,
        excerpt: weakPost.text,
        postedAt: weakPost.postedAt,
      })
      .returning({ id: posts.id });

    await plainWorker.boss.send(filterQueue, {
      monitorId,
      postIds: [sourdoughRow?.id, weakRow?.id],
    });

    const reached = await until("the posts to reach the classify step", () =>
      plainClassified.find((payload) => payload.monitorId === monitorId),
    );

    // The keyword stage dropped one. The other reaches the model, because a
    // stage that is not running drops nothing.
    expect(reached.postIds).toEqual([weakRow?.id]);
  }, 30_000);
});
