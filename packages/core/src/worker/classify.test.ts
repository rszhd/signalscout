/**
 * The classify step, driven the way the worker drives it.
 *
 * docs/testing.md asks for exactly this file: the classifier's error handling
 * is a `catch`, and a `catch` obliges an assertion on the happy path of the
 * thing it wraps, driven from where production drives it. So these cases start
 * at the poll queue or the classify queue, run through `startWorker`, and read
 * the rows afterwards. The classifier is the real one; only the model
 * underneath it is a stub, and the stub answers with our own JSON shape.
 *
 * Nothing here reaches a provider. The stub is passed in, and `vitest.config`
 * blanks AI_API_KEY so a machine with a key exported cannot spend one.
 */

import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClassifier } from "../ai/classify.js";
import type { AiConfig } from "../ai/config.js";
import { createDatabase, type Database } from "../db/client.js";
import { matches, modelCalls, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { maxClassificationAttempts } from "./classify.js";
import { classifyQueue, pollQueue } from "./queues.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fakeRegistry, fastRetries, insertMonitor, until } from "./testing.js";

/** The four-person SaaS post: PLAN.md's strongest example, at intent 96. */
const strongPost = fakePosts[3] as (typeof fakePosts)[number];
/** "Playwright is awesome": PLAN.md's weakest, at intent 3. */
const weakPost = fakePosts[0] as (typeof fakePosts)[number];

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

const weakAnswer = JSON.stringify({
  reasons: ["Praises a testing tool", "Asks for nothing and reports no problem"],
  relevance: 90,
  problemFit: 10,
  icpFit: 50,
  intent: 3,
  urgency: 0,
  intentType: "none",
});

const aiConfig: AiConfig = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  apiKey: "test-key",
  timeoutMs: 5_000,
};

/** What the stub model does with the next call. A test sets it, then acts. */
let answer: (prompt: string) => string = () => strongAnswer;
let calls: string[] = [];

const model = new MockLanguageModelV4({
  provider: "test",
  modelId: "test-model",
  doGenerate: async ({ prompt }) => {
    const text = JSON.stringify(prompt);
    calls.push(text);

    return {
      content: [{ type: "text" as const, text: answer(text) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 120, text: 120, reasoning: 0 },
      },
      warnings: [],
    };
  },
});

let database: TestDatabase;
let worker: WorkerHandle;
let db: Database;
let closeDb: () => Promise<void>;
const notified: Array<{ monitorId: string; matchIds: readonly string[] }> = [];
const lines: Array<Record<string, unknown>> = [];

async function insertPost(post: (typeof fakePosts)[number], externalId = post.externalId) {
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

beforeAll(async () => {
  database = await createTestDatabase("worker_classify");
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
    registry: fakeRegistry({ posts: [strongPost] }),
    credentialsFor: () => ({ token: "test-token" }),
    // The real classifier over a stub model: the seam between them is the part
    // that must not be able to report a bug as a handled model failure.
    classifier: createClassifier({ config: aiConfig, model }),
    steps: {
      notify: async ({ monitorId, matchIds }) => {
        notified.push({ monitorId, matchIds });
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
  answer = () => strongAnswer;
  calls = [];
  notified.length = 0;
  lines.length = 0;
});

describe("a post the model scores", () => {
  it("becomes a match carrying the model's scores and reasons, and is notified", async () => {
    const monitorId = await insertMonitor(database);

    // Driven from the poll queue: the same entry point production uses, so the
    // filter and the classify handler both run.
    await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });

    const notification = await until("the notification for this monitor", () =>
      notified.find((entry) => entry.monitorId === monitorId && entry.matchIds.length > 0),
    );

    const [match] = await db.select().from(matches).where(eq(matches.monitorId, monitorId));

    expect(match).toBeDefined();
    expect(notification.matchIds).toEqual([match?.id]);

    // The numbers the model returned, not numbers this test computed.
    expect(match?.relevance).toBe(98);
    expect(match?.problemFit).toBe(96);
    expect(match?.icpFit).toBe(91);
    expect(match?.intent).toBe(88);
    expect(match?.urgency).toBe(82);
    expect(match?.intentType).toBe("recommendation_request");
    // 0.35 x 88 + 0.25 x 96 + 0.20 x 98 + 0.10 x 91 + 0.10 x 82 = 91.7
    expect(match?.score).toBe(92);
    expect(match?.reasons).toContain("Asks what tools other small teams use");
  }, 30_000);

  it("records what the call cost, whatever it scored", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "cost-1");

    answer = () => weakAnswer;
    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });

    const [call] = await until("the call to be recorded", async () => {
      const rows = await db
        .select()
        .from(modelCalls)
        .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.postId, postId)));
      return rows.length > 0 ? rows : undefined;
    });

    expect(call?.provider).toBe("anthropic");
    expect(call?.model).toBe("claude-haiku-4-5");
    expect(call?.outcome).toBe("scored");
    expect(call?.inputTokens).toBe(900);
    expect(call?.outputTokens).toBe(120);
    expect(call?.latencyMs).toBeTypeOf("number");
    // 900 input tokens at $1 per million, 120 output at $5 per million.
    expect(call?.estimatedCostMicros).toBe(1_500);
  }, 30_000);
});

describe("the minimum score", () => {
  it("keeps a low-scoring post out of the inbox", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "threshold-1");

    answer = () => weakAnswer;
    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });

    await until("the monitor to be notified", () =>
      notified.find((entry) => entry.monitorId === monitorId),
    );

    // 0.35 x 3 + 0.25 x 10 + 0.20 x 90 + 0.10 x 50 + 0.10 x 0 = 26.55, under
    // the default of 30.
    const rows = await db.select().from(matches).where(eq(matches.monitorId, monitorId));
    expect(rows).toHaveLength(0);
  }, 30_000);

  /**
   * The same post and the same scores, against two monitors that disagree
   * about what is worth reading. The threshold is a column, not a constant,
   * and this is the case that would still pass if it were a constant only when
   * both monitors happened to share the default.
   */
  it("is the monitor's own, not a constant", async () => {
    const permissive = await insertMonitor(database, { minScore: 30 });
    const strict = await insertMonitor(database, { minScore: 95 });
    const postId = await insertPost(strongPost, "threshold-2");

    for (const monitorId of [permissive, strict]) {
      await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });
      await until(`monitor ${monitorId} to be notified`, () =>
        notified.find((entry) => entry.monitorId === monitorId),
      );
    }

    // The score is 92: over the first monitor's bar and under the second's.
    expect(await db.select().from(matches).where(eq(matches.monitorId, permissive))).toHaveLength(
      1,
    );
    expect(await db.select().from(matches).where(eq(matches.monitorId, strict))).toHaveLength(0);
  }, 30_000);
});

describe("a model that fails", () => {
  it("writes no match, records the failure, and lets the job retry", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(strongPost, "failure-1");

    answer = () => {
      throw new APICallError({
        message: "overloaded_error",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 529,
      });
    };

    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });

    // More than one recorded failure means the job ran again: the step threw,
    // and the queue brought it back. A post left unclassified has to be
    // retryable, and `fastRetries` allows this job three runs in all.
    const failures = await until("every retry to be recorded", async () => {
      const rows = await db
        .select()
        .from(modelCalls)
        .where(and(eq(modelCalls.monitorId, monitorId), eq(modelCalls.postId, postId)));
      return rows.length >= fastRetries.retryLimit + 1 ? rows : undefined;
    });

    expect(failures.every((row) => row.outcome === "failed")).toBe(true);
    expect(failures[0]?.error).toContain("overloaded_error");
    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(0);
  }, 30_000);

  it("drops a post that has already failed too many times, and stops calling the model", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(strongPost, "failure-2");

    // The failures of earlier runs, as the table would hold them. The count is
    // read from the database and not from this process, so a restart between
    // attempts does not hand the post a fresh allowance.
    await db.insert(modelCalls).values(
      Array.from({ length: maxClassificationAttempts }, () => ({
        monitorId,
        postId,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        outcome: "failed" as const,
        latencyMs: 10,
        error: "overloaded_error",
      })),
    );

    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });

    await until("the monitor to be notified", () =>
      notified.find((entry) => entry.monitorId === monitorId),
    );

    // No fourth call: the drop happens before the money is spent, and the job
    // completes rather than retrying for ever.
    expect(calls).toHaveLength(0);
    expect(
      lines.some(
        (line) =>
          line.postId === postId &&
          String(line.msg).includes("the model failed on this post too many times"),
      ),
    ).toBe(true);
  }, 30_000);
});

/**
 * A poll hands on every post it saw, new and already stored, because a post
 * one monitor has seen is new to another. So this step is routinely given
 * posts it has already paid to classify.
 */
describe("a post already scored for this monitor", () => {
  it("is not sent to the model a second time", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(strongPost, "repeat-1");

    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });
    await until("the first match", async () => {
      const rows = await db.select().from(matches).where(eq(matches.monitorId, monitorId));
      return rows.length > 0 ? rows : undefined;
    });

    expect(calls).toHaveLength(1);

    notified.length = 0;
    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });
    await until("the second job to finish", () =>
      notified.find((entry) => entry.monitorId === monitorId),
    );

    expect(calls).toHaveLength(1);
    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(1);
  }, 30_000);
});
