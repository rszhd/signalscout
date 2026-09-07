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
import { classifiedPostCounts } from "../ai/record.js";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, budgets, matches, modelCalls, monitors, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import { updateMonitor } from "../monitors/monitors.js";
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
const continued: { monitorId: string; postIds: readonly string[] }[] = [];
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
      // US-048's loop. A thread is read fifty comments at a time and the
      // decision to buy the next fifty needs the verdicts on the last fifty,
      // which exist only when this step has finished.
      replies: async ({ monitorId, postIds }) => {
        continued.push({ monitorId, postIds: [...postIds] });
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
  continued.length = 0;
  lines.length = 0;
});

/** The classification calls recorded for one pair, oldest first. */
async function callsFor(monitorId: string, postId: string) {
  return db
    .select({ outcome: modelCalls.outcome, monitorVersion: modelCalls.monitorVersion })
    .from(modelCalls)
    .where(
      and(
        eq(modelCalls.monitorId, monitorId),
        eq(modelCalls.postId, postId),
        eq(modelCalls.purpose, "classification"),
      ),
    )
    .orderBy(modelCalls.createdAt);
}

/** Run one classify job and wait for the notification that ends it. */
async function classifyAndWait(monitorId: string, postIds: readonly string[]) {
  notified.length = 0;
  await worker.boss.send(classifyQueue, { monitorId, postIds: [...postIds] });
  await until("the classify job to finish", () =>
    notified.find((entry) => entry.monitorId === monitorId),
  );
}

/**
 * BUG-004. The cap can be crossed between a batch's first item and its last.
 *
 * `enforceBudget` answers "may this work start", and that is the right question
 * for a poll: one poll buys one bounded set of pages. It is the wrong question
 * for a batch of 123 classifications, and US-020's live run measured what that
 * costs — a poll of 23 posts fanned out into 328 replies, 654 triage calls and
 * 146 classifications, and the guard was asked nothing between any of them.
 *
 * The failure shape docs/testing.md names for this surface is "money spent past
 * a cap, silently, at 02:00". These are the cases that go red if it comes back.
 */
describe("a monitor that runs out of money mid-batch", () => {
  async function capped(capMicros: number): Promise<string> {
    const monitorId = await insertMonitor(database);

    await db
      .insert(budgets)
      .values({ monitorId, monthlyCapMicros: capMicros, onExhausted: "notify" });

    return monitorId;
  }

  it("classifies nothing when the cap is already gone", async () => {
    // A cap of zero is spent before anything starts, which is the state a
    // monitor reaches partway through any month.
    const monitorId = await capped(0);
    const postId = await insertPost(strongPost, "cap-none-1");

    answer = () => strongAnswer;
    await classifyAndWait(monitorId, [postId]);

    const calls = await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId));

    expect(calls).toEqual([]);
  }, 30_000);

  it("stops part-way and does not classify the rest", async () => {
    // One classification costs 1,500 micro-dollars here, so this cap pays for
    // two and then runs out.
    const monitorId = await capped(3_000);
    const ids = await Promise.all([
      insertPost(strongPost, "cap-part-1"),
      insertPost(strongPost, "cap-part-2"),
      insertPost(strongPost, "cap-part-3"),
      insertPost(strongPost, "cap-part-4"),
    ]);

    answer = () => strongAnswer;
    await classifyAndWait(monitorId, ids);

    const calls = await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId));

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(ids.length);
  }, 30_000);

  /**
   * The difference between stopping and losing.
   *
   * A post the cap stopped us reaching has no `model_calls` row and no match,
   * so it looks exactly like a post the model had never been shown — which is
   * what makes a later poll pick it up. A post marked in any way here would be
   * a lead deleted by an accounting decision.
   */
  it("leaves the posts it did not reach exactly as it found them", async () => {
    const monitorId = await capped(0);
    const postId = await insertPost(strongPost, "cap-keeps-1");

    answer = () => strongAnswer;
    await classifyAndWait(monitorId, [postId]);

    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toEqual([]);
    expect(await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId))).toEqual(
      [],
    );
  }, 30_000);

  it("classifies them once there is room again", async () => {
    const monitorId = await capped(0);
    const postId = await insertPost(strongPost, "cap-later-1");

    answer = () => strongAnswer;
    await classifyAndWait(monitorId, [postId]);

    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toEqual([]);

    // A person raises the cap. The post is still there and still unscored.
    await db
      .update(budgets)
      .set({ monthlyCapMicros: 1_000_000 })
      .where(eq(budgets.monitorId, monitorId));

    await classifyAndWait(monitorId, [postId]);

    const found = await db.select().from(matches).where(eq(matches.monitorId, monitorId));

    expect(found).toHaveLength(1);
  }, 30_000);

  it("does not stop a monitor that has no cap at all", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(strongPost, "cap-free-1");

    answer = () => strongAnswer;
    await classifyAndWait(monitorId, [postId]);

    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(1);
  }, 30_000);
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
        monitorVersion: 1,
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
 *
 * BUG-003 is what these cases pin. The skip used to ask `matches`, which is a
 * different question: a post scored below the monitor's threshold writes no
 * match, so nothing recorded the work and the next poll bought the same answer
 * again. On the development database that was 72 of 229 pairs.
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

  it("is not sent to the model a second time when it scored below the threshold", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "repeat-below-1");
    answer = () => weakAnswer;

    await classifyAndWait(monitorId, [postId]);

    expect(calls).toHaveLength(1);
    expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(0);

    await classifyAndWait(monitorId, [postId]);

    // The case the old skip could not see. There is no match to ask about, so
    // the only record that this post was paid for is the call itself.
    expect(calls).toHaveLength(1);
    expect(await callsFor(monitorId, postId)).toHaveLength(1);
  }, 30_000);

  it("is scored again after the monitor's definition changes", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "repeat-version-1");
    answer = () => weakAnswer;

    await classifyAndWait(monitorId, [postId]);
    expect(calls).toHaveLength(1);

    // An edit to one of the four fields the system prompt is built from. The
    // real writer, because the rule that moves the version lives in it.
    const edited = await updateMonitor(db, monitorId, {
      problem: "End-to-end suites that fail for reasons nobody can reproduce",
    });
    expect(edited?.version).toBe(2);

    await classifyAndWait(monitorId, [postId]);

    // A different question, so the old answer does not stand in for it.
    expect(calls).toHaveLength(2);
    expect((await callsFor(monitorId, postId)).map((row) => row.monitorVersion)).toEqual([1, 2]);
  }, 30_000);

  /**
   * The count the monitor screen puts beside the drops. It says how many posts
   * the AI read, so a post re-scored under a new version is one post and not
   * two — the same distinction BUG-003 turned on.
   */
  it("counts as one post read, however many times it was scored", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "counted-once");
    answer = () => weakAnswer;

    await classifyAndWait(monitorId, [postId]);
    await updateMonitor(db, monitorId, { problem: "Suites that fail for no reason" });
    await classifyAndWait(monitorId, [postId]);

    expect(await callsFor(monitorId, postId)).toHaveLength(2);
    expect((await classifiedPostCounts(db, [monitorId])).get(monitorId)).toBe(1);
  }, 30_000);

  it("is not scored again for a rename, a new query or a moved threshold", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(weakPost, "repeat-version-2");
    answer = () => weakAnswer;

    await classifyAndWait(monitorId, [postId]);
    expect(calls).toHaveLength(1);

    // Three edits that change what is collected, or how it is ranked, and not
    // what a good lead is. None of them moves the version.
    const edited = await updateMonitor(db, monitorId, {
      name: "Renamed monitor",
      queries: { reddit: ["broken end to end tests"] },
      minScore: 10,
    });
    expect(edited?.version).toBe(1);

    await classifyAndWait(monitorId, [postId]);

    expect(calls).toHaveLength(1);
  }, 30_000);

  it("is still scored for a second monitor that has never seen it", async () => {
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "The other monitor" });
    const postId = await insertPost(weakPost, "repeat-two-monitors-1");
    answer = () => weakAnswer;

    await classifyAndWait(first, [postId]);
    await classifyAndWait(second, [postId]);

    // The skip is per monitor. A post one monitor has paid for is new to the
    // next one, which is the whole reason the poll hands on every post it saw.
    expect(calls).toHaveLength(2);
    expect(await callsFor(second, postId)).toHaveLength(1);
  }, 30_000);

  it("gets a fresh allowance of attempts when the monitor's definition changes", async () => {
    const monitorId = await insertMonitor(database);
    const postId = await insertPost(strongPost, "repeat-failures-1");

    await db.insert(modelCalls).values(
      Array.from({ length: maxClassificationAttempts }, () => ({
        monitorId,
        monitorVersion: 1,
        postId,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        outcome: "failed" as const,
        latencyMs: 10,
        error: "overloaded_error",
      })),
    );

    await classifyAndWait(monitorId, [postId]);
    expect(calls).toHaveLength(0);

    await updateMonitor(db, monitorId, { problem: "Tests that pass and fail on the same commit" });
    await classifyAndWait(monitorId, [postId]);

    // The limit counts what this question could not answer. A new question has
    // not been asked yet, so the post gets its three chances again.
    expect(calls).toHaveLength(1);
  }, 30_000);
});

/**
 * The end of BUG-003, measured where it was paid: a poll, and then the same
 * poll again. The provider returns the page it returned last time, dedup stops
 * a second post row, and nothing may buy a second answer about it.
 */
it("makes no classification call when a poll returns a page it has already seen", async () => {
  // A bar the fake connector's post cannot clear, so the poll leaves no match.
  // That is the shape the bug was measured in: 72 of the 75 pairs classified
  // twice on the development database had no match row to skip on.
  const monitorId = await insertMonitor(database, { minScore: 100 });

  await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });
  // Waited on the notification and not on the model call: the notification is
  // the last step of the poll, so nothing of the first poll is still running
  // when the second one starts.
  await until("the first poll to finish", () =>
    notified.find((entry) => entry.monitorId === monitorId),
  );

  expect(calls).toHaveLength(1);
  expect(
    await db.select().from(modelCalls).where(eq(modelCalls.monitorId, monitorId)),
  ).toHaveLength(1);

  // The second poll asks for the same window as the first, so the connector
  // hands back the page it handed back last time. That is not a contrivance:
  // US-026's live ScrapeCreators run collected 47 posts and stored none.
  await db.update(monitors).set({ lastPolledAt: null }).where(eq(monitors.id, monitorId));

  calls.length = 0;
  notified.length = 0;
  await worker.boss.send(pollQueue, { monitorId }, { singletonKey: monitorId });
  await until("the second poll to finish", () =>
    notified.find((entry) => entry.monitorId === monitorId),
  );

  // The second poll ran and was billed for it. Asserting only "no model call"
  // would pass just as well if nothing had polled at all, and the provider's
  // bill is the half of this that does not go away: the search is paid for
  // whether or not it brings back anything new.
  const [usage] = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));
  expect(usage?.units).toBe(2);
  expect(calls).toEqual([]);
  expect(await db.select().from(matches).where(eq(matches.monitorId, monitorId))).toHaveLength(0);
}, 30_000);

it("does not pay the model to read a post already confirmed deleted", async () => {
  const monitorId = await insertMonitor(database);
  const postId = await insertPost(strongPost, "t3_confirmed_deleted");
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
  await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });
  await until("the deleted post job to finish", () =>
    notified.find((entry) => entry.monitorId === monitorId),
  );
  expect(calls).toEqual([]);
  expect(await db.select().from(matches).where(eq(matches.postId, postId))).toEqual([]);
});

/**
 * US-048's loop, closed from this end.
 *
 * A thread is read fifty comments at a time, and whether to buy the next fifty
 * needs the verdicts on the last fifty — which exist only when this step has
 * finished. So this step sends the thread back to `replies`, and `replies`
 * owns the rule. A step that scores posts must not also decide how deep a
 * thread is read, which is why what is asserted here is only that the thread
 * is offered, never what happens to it.
 */
describe("continuing a thread after its batch has been judged", () => {
  it("sends the parent thread back once per batch of replies", async () => {
    const monitorId = await insertMonitor(database, {});
    const parentId = await insertPost(fakePosts[0] as (typeof fakePosts)[number], "t3_loop_parent");

    const asReply = async (externalId: string) => {
      const [row] = await db
        .insert(posts)
        .values({
          source: "reddit",
          externalId,
          url: `https://www.reddit.com/r/SaaS/comments/loop/${externalId}/`,
          excerpt: "We hit this too. What did you end up using?",
          postedAt: new Date("2026-09-05T09:00:00.000Z"),
          kind: "reply" as const,
          parentPostId: parentId,
        })
        .returning({ id: posts.id });

      if (!row) throw new Error("the reply was not inserted");
      return row.id;
    };

    const replyIds = [await asReply("t1_loop_a"), await asReply("t1_loop_b")];

    await worker.boss.send(classifyQueue, { monitorId, postIds: replyIds });
    await until("the thread to be offered again", () => continued[0]);

    // One job for the thread, not one per reply: two replies of the same
    // thread are one batch and one decision.
    expect(continued).toHaveLength(1);
    expect(continued[0]?.postIds).toEqual([parentId]);
  }, 30_000);

  it("offers nothing when the batch held no replies, because a post has no thread", async () => {
    const monitorId = await insertMonitor(database, {});
    const postId = await insertPost(fakePosts[0] as (typeof fakePosts)[number], "t3_loop_plain");

    await worker.boss.send(classifyQueue, { monitorId, postIds: [postId] });
    await until("the notification", () => notified[0]);

    expect(continued).toEqual([]);
  }, 30_000);
});
