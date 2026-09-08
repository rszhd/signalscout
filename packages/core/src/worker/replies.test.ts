/**
 * The replies step, driven the way the worker drives it.
 *
 * Real Postgres, a fake connector, no network and no bill. What is asserted
 * here is the two rules that decide what this feature costs — a thread is
 * opened only under a post the filter kept, and only when something new was
 * said in it — and the one honesty rule that decides whether it is correct:
 * a thread we half read is recorded as half read.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { apiUsage, budgets, matches, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import type { CandidateReply } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import type { ClassifyPayload, FilterPayload } from "./queues.js";
import { repliesQueue } from "./queues.js";
import {
  maxCommentsPerThread,
  maxEmptyBatches,
  maxPagesPerThread,
  replyBatchSize,
} from "./replies.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fakeRegistry, fastRetries, insertMonitor, until } from "./testing.js";

/** The account these cases spend on. BUG-009 put the owner on every usage row. */
const owner = "user-1";

const postedAt = new Date("2026-09-05T09:00:00.000Z");

/**
 * A two-reply thread whose ids belong to the post it hangs under.
 *
 * Derived rather than fixed so that two cases in this file never share a reply
 * row: `posts` is keyed by `(source, external_id)`, and a shared id would make
 * one case's insert the next case's conflict.
 */
function threadUnder(postExternalId: string): readonly CandidateReply[] {
  const reply = (id: string, text: string, parentReply?: string): CandidateReply => ({
    externalId: `t1_${postExternalId}_${id}`,
    url: `https://www.reddit.com/r/SaaS/comments/${postExternalId}/comment/${id}/`,
    author: "a-redditor",
    channel: "SaaS",
    text,
    postedAt,
    parentPostExternalId: postExternalId,
    ...(parentReply ? { parentReplyExternalId: `t1_${postExternalId}_${parentReply}` } : {}),
  });

  return [
    reply("one", "We hit this too. What did you end up using?"),
    reply("two", "We moved to Playwright and it has been fine.", "one"),
  ];
}

let database: TestDatabase;
let worker: WorkerHandle;
let db: Database;
let closeDb: () => Promise<void>;
const filtered: FilterPayload[] = [];
/** Every reply fetch the step made, so a case can assert what it asked for. */
const replyRequests: { since?: Date }[] = [];
const classified: ClassifyPayload[] = [];

let nextId = 0;

async function insertPost(
  externalId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  nextId += 1;

  const [row] = await db
    .insert(posts)
    .values({
      source: "reddit",
      externalId: `${externalId}_${nextId}`,
      url: "https://www.reddit.com/r/SaaS/comments/thread/",
      channel: "SaaS",
      title: "Our end to end tests break every release",
      excerpt: "We are a four-person SaaS and the suite breaks whenever the UI changes.",
      postedAt,
      ...overrides,
    })
    .returning({ id: posts.id });

  if (!row) throw new Error("the post was not inserted");
  return row.id;
}

async function run(monitorId: string, postIds: string[]): Promise<void> {
  await worker.boss.send(repliesQueue, { monitorId, postIds });
}

beforeAll(async () => {
  database = await createTestDatabase("worker_replies");
  ({ db, close: closeDb } = createDatabase(database.url));

  worker = await startWorker({
    databaseUrl: database.url,
    logger: createLogger({ level: "silent", name: "test" }),
    registry: fakeRegistry({
      replies: threadUnder,
      unitsPerReplyCall: 1,
      onFetchReplies: (request) => replyRequests.push(request),
    }),
    credentialsFor: () => ({ token: "test-token" }),
    steps: {
      filter: async (payload) => {
        filtered.push(payload);
      },
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
  replyRequests.length = 0;
  filtered.length = 0;
  classified.length = 0;
});

describe("opening a thread", () => {
  it("stores each reply as its own row, linked to the post above it", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const stored = await db
      .select()
      .from(posts)
      .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

    expect(stored).toHaveLength(2);

    const first = stored.find((row) => row.externalId.endsWith("_one"));
    const second = stored.find((row) => row.externalId.endsWith("_two"));

    expect(first?.parentReplyExternalId).toBeNull();
    // The nested one names the reply above it, which is what reaches the prompt.
    expect(second?.parentReplyExternalId).toBe(first?.externalId);
    // A reply has no title of its own: the post's title is read through the link.
    expect(first?.title).toBeNull();
  }, 20_000);

  it("sends the replies back through the filter, not straight to the model", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", { replyCount: 2 });

    await run(monitorId, [postId]);
    const payload = await until("the replies to reach the filter", () => filtered[0]);

    expect(payload.postIds).toHaveLength(2);
    // A reply meets triage there and nothing else. Going straight to the
    // classifier would skip the only stage that can read it.
    expect(classified).toEqual([]);
  }, 20_000);

  it("bills the reply page against the monitor, at the connector's reply price", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toHaveLength(1);
    expect(usage[0]?.units).toBe(1);
  }, 20_000);

  it("records the thread as partly read, because the provider cannot promise otherwise", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const [row] = await db.select().from(posts).where(eq(posts.id, postId));

    // Not "done". A top-level has_more: false arrives on threads missing half
    // their comments, so this is our own honesty and not the provider's.
    expect(row?.repliesPartial).toBe(true);
  }, 20_000);
});

/** A worker whose fake serves `pages` pages before it says done. */
async function workerServing(pages: number, dryAfter?: number) {
  const database = await createTestDatabase(
    `worker_replies_p${pages}${dryAfter === undefined ? "" : `d${dryAfter}`}`,
  );
  const { db, close } = createDatabase(database.url);
  const seen: FilterPayload[] = [];

  const worker = await startWorker({
    databaseUrl: database.url,
    logger: createLogger({ level: "silent", name: "test" }),
    registry: fakeRegistry({
      replies: threadUnder,
      unitsPerReplyCall: 1,
      replyPages: pages,
      ...(dryAfter === undefined ? {} : { repliesRunDryAfter: dryAfter }),
    }),
    credentialsFor: () => ({ token: "test-token" }),
    steps: {
      filter: async (payload) => {
        seen.push(payload);
      },
      classify: async () => {},
    },
    retry: fastRetries,
    scheduleTicks: false,
  });

  return {
    db,
    seen,
    async run(monitorId: string, postIds: string[]) {
      await worker.boss.send(repliesQueue, { monitorId, postIds });
    },
    async stop() {
      await worker.stop();
      await close();
      await database.drop();
    },
    database,
  };
}

/**
 * Paging one thread, and the bound on it.
 *
 * Found missing by reading US-034's live YouTube run rather than by this file:
 * the step called `fetchReplies` once and never read `next`, so a video with
 * three thousand comments gave us the newest fifty-one and stopped. The
 * ninety-day window hides that on a quiet thread and not on a busy one.
 */
describe("a thread with more than one page", () => {
  it("follows the cursor rather than stopping at page one", async () => {
    const harness = await workerServing(3);

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const [row] = await harness.db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: "t3_paged",
          url: "https://www.reddit.com/r/SaaS/comments/paged/",
          excerpt: "A busy thread.",
          postedAt,
          replyCount: 40,
        })
        .returning({ id: posts.id });

      await harness.run(monitorId, [row?.id as string]);
      await until("the replies to reach the filter", () => harness.seen[0]);

      const usage = await harness.db
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.monitorId, monitorId));

      // Three pages, three credits, and every page's replies stored.
      expect(usage[0]?.units).toBe(3);
      expect(
        (
          await harness.db
            .select()
            .from(posts)
            .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, row?.id as string)))
        ).length,
      ).toBe(6);
    } finally {
      await harness.stop();
    }
  }, 60_000);

  it("numbers the second page after the first, not from zero again", async () => {
    const harness = await workerServing(3);

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const [row] = await harness.db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: "t3_paged_positions",
          url: "https://www.reddit.com/r/SaaS/comments/paged-positions/",
          excerpt: "A busy thread whose positions must not collide.",
          postedAt,
          replyCount: 40,
        })
        .returning({ id: posts.id });

      await harness.run(monitorId, [row?.id as string]);
      await until("the replies to reach the filter", () => harness.seen[0]);

      const stored = await harness.db
        .select({ position: posts.threadPosition })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, row?.id as string)));

      const positions = stored.map((entry) => entry.position ?? -1).sort((a, b) => a - b);

      // Three pages of two. Each page continues the count instead of starting
      // again, which is what the offset taken from `itemsReturned` buys — and
      // without it every page would be numbered 0 and 1.
      expect(positions).toEqual([0, 1, 2, 3, 4, 5]);
    } finally {
      await harness.stop();
    }
  }, 60_000);

  /**
   * A thread that never ends is the shape this bound exists for. Without it a
   * busy video would page until the monitor's whole cap was gone.
   */
  it("stops at the page bound and records the thread as partly read", async () => {
    const harness = await workerServing(50);

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const [row] = await harness.db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: "t3_endless",
          url: "https://www.reddit.com/r/SaaS/comments/endless/",
          excerpt: "A thread with no end.",
          postedAt,
          replyCount: 5_000,
        })
        .returning({ id: posts.id });

      await harness.run(monitorId, [row?.id as string]);
      await until("the replies to reach the filter", () => harness.seen[0]);

      const usage = await harness.db
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.monitorId, monitorId));

      expect(usage[0]?.units).toBe(maxPagesPerThread);

      // Stopped by our own bound, so it is partly read whatever the provider
      // said about the page we stopped on. Recording it complete would mean
      // never coming back.
      const [post] = await harness.db
        .select()
        .from(posts)
        .where(eq(posts.id, row?.id as string));

      expect(post?.repliesPartial).toBe(true);
    } finally {
      await harness.stop();
    }
  }, 60_000);
});

/**
 * A cursor that leads nowhere, which is measured rather than imagined.
 *
 * US-020 asked SocialCrawl for an X thread: 28 replies, `has_more: true`, and
 * the cursor returned zero items. It was refunded, so trusting the flag cost a
 * round trip and no money — but paging on from an empty page would ask the same
 * question again and be charged for the same silence.
 */
describe("a cursor with nothing behind it", () => {
  it("stops on the first empty page rather than paging into silence", async () => {
    const harness = await workerServing(50, 1);

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const [row] = await harness.db
        .insert(posts)
        .values({
          source: "reddit",
          externalId: "t3_dry",
          url: "https://www.reddit.com/r/SaaS/comments/dry/",
          excerpt: "A thread that promises more than it has.",
          postedAt,
          replyCount: 40,
        })
        .returning({ id: posts.id });

      await harness.run(monitorId, [row?.id as string]);
      await until("the replies to reach the filter", () => harness.seen[0]);

      const usage = await harness.db
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.monitorId, monitorId));

      // Page one had replies, page two was empty and ended the walk. Not the
      // four the bound would have allowed.
      expect(usage[0]?.units).toBe(2);
    } finally {
      await harness.stop();
    }
  }, 60_000);
});

describe("what is never bought", () => {
  it("buys nothing for a monitor that does not read replies", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: false });
    const postId = await insertPost("t3_thread", { replyCount: 2 });

    await run(monitorId, [postId]);

    // There is no signal for "the job ran and did nothing", so this waits
    // rather than watching. It is why the cases after it carry a longer
    // timeout: the queue is still working through what these left behind.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toEqual([]);
    expect(filtered).toEqual([]);
  }, 20_000);

  /**
   * The rule that stops a monitor re-buying every thread it has ever seen.
   *
   * Without it, an hourly poll pays for the same conversation every hour for
   * the life of the monitor, and the second read stores nothing because the
   * replies are already there.
   */
  it("does not re-open a thread that has been read fully and has not grown", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", {
      replyCount: 2,
      repliesPartial: false,
    });

    await run(monitorId, [postId]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toEqual([]);
  }, 20_000);

  it("re-opens a thread it only half read, even when the count has not moved", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_thread", { replyCount: 2, repliesPartial: true });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    // The count was never the reason we stopped, so an unchanged count is no
    // reason not to go back.
    expect(usage).toHaveLength(1);
  }, 20_000);

  /**
   * Found by a live run, not by this file.
   *
   * US-034's YouTube poll opened eleven threads for eleven credits and got
   * seven comments back. Half those videos carried a comment count of zero on
   * the row already, so the money bought answers the platform had already told
   * us would be empty.
   */
  it("does not open a thread the platform says is empty", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_empty", { replyCount: 0 });

    await run(monitorId, [postId]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toEqual([]);
  }, 20_000);

  it("opens a thread with one comment, because that comment may be the lead", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_one_comment", { replyCount: 1 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toHaveLength(1);
  }, 20_000);

  it("opens a thread whose count the platform never gave, because null is not zero", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_unknown_count");

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toHaveLength(1);
  }, 20_000);

  /**
   * The window, which a live run showed was missing entirely.
   *
   * US-034's YouTube poll returned a comment from June 2021 as a lead. A thread
   * outlives the post above it, so a video collected today can carry comments
   * from years ago and the monitor's poll mark says nothing about them.
   */
  it("gives the connector a window, so a five-year-old comment is not a lead", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_windowed", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const [asked] = replyRequests;

    expect(asked?.since).toBeInstanceOf(Date);

    // Ninety days by default. A monitor polled hourly narrows it; a monitor
    // polled for the first time still must not be handed 2015.
    const since = asked?.since as Date;
    const days = (Date.now() - since.getTime()) / 86_400_000;

    expect(days).toBeGreaterThan(85);
    expect(days).toBeLessThan(95);
  }, 20_000);

  /**
   * BUG-006, and the live run that found it.
   *
   * The window used to be the later of the default and the monitor's poll
   * mark. `collect.ts` sets that mark to `now()` when a collection finishes,
   * and the replies step runs after it in the same poll — so every provider
   * was asked for comments written after the poll had already started. On
   * 2026-09-06 a TikTok poll opened twenty-five threads, paid for twenty-five
   * pages, and stored no comment at all.
   */
  it("reads a thread it has never read from the default window, however recently the monitor polled", async () => {
    const monitorId = await insertMonitor(database, {
      includeReplies: true,
      lastPolledAt: new Date(),
    });
    const postId = await insertPost("t3_polled_just_now", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered[0]);

    const since = replyRequests.at(-1)?.since as Date;
    const days = (Date.now() - since.getTime()) / 86_400_000;

    expect(days).toBeGreaterThan(85);

    // And the replies are stored, which is the half the old assertion missed:
    // asking the wrong question returned an empty page, not an error.
    const stored = await db
      .select()
      .from(posts)
      .where(and(eq(posts.parentPostId, postId), eq(posts.kind, "reply")));

    expect(stored).toHaveLength(2);
  }, 20_000);

  it("narrows the window to this thread's own last read, so the same comments are not bought twice", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const readAt = new Date("2026-09-05T12:00:00.000Z");
    const postId = await insertPost("t3_read_before", {
      replyCount: 2,
      repliesReadAt: readAt,
      repliesPartial: true,
    });

    const seen = replyRequests.length;

    await run(monitorId, [postId]);
    await until("the thread to be opened", () =>
      replyRequests.length > seen ? replyRequests.at(-1) : undefined,
    );

    // The thread's mark, not the ninety-day floor, because it is later.
    expect(replyRequests.at(-1)?.since?.getTime()).toBe(readAt.getTime());
  }, 20_000);

  it("writes the mark from before the fetch, so a comment written during the walk is not skipped", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_marks_itself", { replyCount: 2 });
    const before = new Date();

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered.at(-1));

    const [row] = await db
      .select({ readAt: posts.repliesReadAt })
      .from(posts)
      .where(eq(posts.id, postId));

    expect(row?.readAt).toBeInstanceOf(Date);
    expect(row?.readAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row?.readAt?.getTime()).toBeLessThanOrEqual(Date.now());
  }, 20_000);

  /**
   * US-048's instrument, and the reason it is not array order.
   *
   * The position has to be the provider's, counting everything it returned.
   * The measurement it exists for asks whether this product's leads sit where
   * the platform ranks highest, and an ordering that quietly closed the gaps
   * over dropped items would answer a different question.
   */
  it("stores the position the provider put each reply at, and keeps counting across pages", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const postId = await insertPost("t3_positions", { replyCount: 2 });

    await run(monitorId, [postId]);
    await until("the replies to reach the filter", () => filtered.at(-1));

    const stored = await db
      .select({ externalId: posts.externalId, position: posts.threadPosition })
      .from(posts)
      .where(and(eq(posts.parentPostId, postId), eq(posts.kind, "reply")));

    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.position).sort()).toEqual([0, 1]);
  }, 20_000);

  it("never opens a thread under a reply, which is what stops this looping", async () => {
    const monitorId = await insertMonitor(database, { includeReplies: true });
    const parentId = await insertPost("t3_parent_for_reply", { replyCount: 1 });
    const replyId = await insertPost("t1_standalone", {
      kind: "reply",
      parentPostId: parentId,
      title: null,
    });

    await run(monitorId, [replyId]);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const usage = await db.select().from(apiUsage).where(eq(apiUsage.monitorId, monitorId));

    expect(usage).toEqual([]);
  }, 20_000);
});

/**
 * US-048's batching, which is the rule that decides what a deep thread costs.
 *
 * Correctness-critical in the money sense: a thread with a hundred thousand
 * comments is $297 of classification if nothing stops it, and a rule that
 * stops too eagerly throws away the better half of a thread — US-048 measured
 * leads sitting three times denser at position 400 than at position 0.
 *
 * These cases drive the fake at fifty replies a page, so one page is one
 * batch and the arithmetic under test is the rule rather than the paging.
 */
describe("reading a thread in batches", () => {
  /** A page-sized thread, so `replyBatchSize` is reached in one page. */
  function bigThreadUnder(postExternalId: string): readonly CandidateReply[] {
    return Array.from({ length: replyBatchSize }, (_, index) => ({
      externalId: `t1_${postExternalId}_${index}`,
      url: `https://www.reddit.com/r/SaaS/comments/${postExternalId}/comment/${index}/`,
      author: "a-redditor",
      channel: "SaaS",
      text: `Comment number ${index}.`,
      postedAt,
      parentPostExternalId: postExternalId,
    }));
  }

  async function deepHarness(name: string) {
    const database = await createTestDatabase(`worker_replies_batch_${name}`);
    const { db, close } = createDatabase(database.url);
    const seen: FilterPayload[] = [];

    const worker = await startWorker({
      databaseUrl: database.url,
      logger: createLogger({ level: "silent", name: "test" }),
      registry: fakeRegistry({
        replies: bigThreadUnder,
        unitsPerReplyCall: 1,
        // Endless, so nothing but our own rules can stop the walk.
        replyPages: 100,
      }),
      credentialsFor: () => ({ token: "test-token" }),
      steps: {
        filter: async (payload) => {
          seen.push(payload);
        },
        classify: async () => {},
      },
      retry: fastRetries,
      scheduleTicks: false,
    });

    return {
      database,
      db,
      seen,
      async run(monitorId: string, postIds: string[]) {
        await worker.boss.send(repliesQueue, { monitorId, postIds });
      },
      async stop() {
        await worker.stop();
        await close();
        await database.drop();
      },
    };
  }

  async function insertThread(db: Database, externalId: string, overrides = {}) {
    const [row] = await db
      .insert(posts)
      .values({
        source: "reddit",
        externalId,
        url: `https://www.reddit.com/r/SaaS/comments/${externalId}/`,
        excerpt: "A very busy thread.",
        postedAt,
        replyCount: 5000,
        ...overrides,
      })
      .returning({ id: posts.id });

    if (!row) throw new Error("the thread was not inserted");
    return row.id;
  }

  it("buys one batch, not the whole thread, and remembers where to resume", async () => {
    const harness = await deepHarness("one");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_one");

      await harness.run(monitorId, [postId]);
      await until("the replies to reach the filter", () => harness.seen[0]);

      const stored = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

      // One batch. Not the 100 pages the fake would happily have sold.
      expect(stored.length).toBe(replyBatchSize);

      const [thread] = await harness.db
        .select({
          cursor: posts.repliesCursor,
          batchStart: posts.repliesBatchStart,
          empty: posts.repliesEmptyBatches,
          stopped: posts.repliesStopped,
        })
        .from(posts)
        .where(eq(posts.id, postId));

      expect(thread?.cursor).not.toBeNull();
      expect(thread?.batchStart).toBe(replyBatchSize);
      // The first batch is never judged: nothing has classified it yet.
      expect(thread?.empty).toBe(0);
      expect(thread?.stopped).toBeNull();
    } finally {
      await harness.stop();
    }
  }, 60_000);

  it("closes a thread on a batch that held no lead, without buying another", async () => {
    const harness = await deepHarness("empty");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_empty");

      // Batch one, which is bought and never judged: nothing has scored it.
      await harness.run(monitorId, [postId]);
      await until("batch one", () => harness.seen[0]);

      const bought = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

      expect(bought.length).toBe(replyBatchSize);

      /**
       * The second job judges batch one and closes the thread, buying nothing.
       *
       * The judgement happens before the purchase, so a thread nobody is
       * talking in costs one batch to rule out — about $0.16 — rather than
       * two. That is what `maxEmptyBatches` of one buys.
       */
      await harness.run(monitorId, [postId]);
      await until("the thread to close", async () => {
        const [row] = await harness.db
          .select({ stopped: posts.repliesStopped })
          .from(posts)
          .where(eq(posts.id, postId));
        return row?.stopped ?? undefined;
      });

      const [closed] = await harness.db
        .select({ empty: posts.repliesEmptyBatches, stopped: posts.repliesStopped })
        .from(posts)
        .where(eq(posts.id, postId));

      expect(closed?.empty).toBe(maxEmptyBatches);
      expect(closed?.stopped).toBe("threshold");

      const after = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

      expect(after.length).toBe(bought.length);

      // And a further job buys nothing at all.
      await harness.run(monitorId, [postId]);
      await new Promise((resolve) => setTimeout(resolve, 700));

      const later = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

      expect(later.length).toBe(bought.length);
    } finally {
      await harness.stop();
    }
  }, 90_000);

  /**
   * The window bug, which a test found and a live run would have hidden.
   *
   * `repliesReadAt` is written when a walk starts. A second batch computing
   * `since` from it asks for comments newer than the moment batch one ran, and
   * every comment in the thread is older than that — so the batch comes back
   * empty, the threshold reads that as "nobody here", and the thread is
   * abandoned having actually been read once.
   */
  it("does not apply the poll window to a batch that is continuing a walk", async () => {
    const harness = await deepHarness("window");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_window");

      await harness.run(monitorId, [postId]);
      await until("batch one", () => harness.seen[0]);

      // A lead in batch one, so the threshold lets the walk continue and this
      // case is about the window rather than about the rule above it.
      const [first] = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.parentPostId, postId), eq(posts.threadPosition, 0)));

      await harness.db.insert(matches).values({
        monitorId,
        postId: first?.id as string,
        score: 80,
        relevance: 80,
        problemFit: 80,
        icpFit: 80,
        intent: 80,
        urgency: 50,
        intentType: "problem",
        reasons: ["A person describing the problem."],
      });

      await harness.run(monitorId, [postId]);
      await until("batch two", () => harness.seen[1]);

      const stored = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.kind, "reply"), eq(posts.parentPostId, postId)));

      // Two batches of fifty. One would mean the second was filtered to
      // nothing by a window that has no business inside a walk.
      expect(stored.length).toBe(replyBatchSize * 2);
    } finally {
      await harness.stop();
    }
  }, 90_000);

  /**
   * A closed thread is not closed for ever.
   *
   * Without this, `repliesStopped` is a life sentence: a thread abandoned on
   * two empty batches in March would never be read again however busy it
   * became, which is the case a monitor exists to catch.
   */
  it("opens a closed thread again when the platform says more was said", async () => {
    const harness = await deepHarness("reopen");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      /**
       * Closed on the threshold at 900 comments, and the platform now says
       * 1,200. The two counts are the whole rule, so they are set up rather
       * than produced: a phase that first proved "unchanged buys nothing" and
       * then changed the count raced under load, because the first job could
       * land after the change and read a batch of its own. The
       * unchanged-count case is covered by the ceiling test below.
       */
      const postId = await insertThread(harness.db, "t3_batch_reopen", {
        replyCount: 1200,
        repliesStopped: "threshold",
        repliesStoppedAtCount: 900,
        repliesBatchStart: 200,
        repliesEmptyBatches: maxEmptyBatches,
      });

      await harness.run(monitorId, [postId]);
      await until("the re-opened thread", () => harness.seen[0]);

      const [thread] = await harness.db
        .select({
          stopped: posts.repliesStopped,
          batchStart: posts.repliesBatchStart,
          empty: posts.repliesEmptyBatches,
        })
        .from(posts)
        .where(eq(posts.id, postId));

      // A fresh walk: the old cursor belonged to a walk that ended, and the
      // old depth would carry into the new one.
      expect(thread?.stopped).toBeNull();
      expect(thread?.batchStart).toBe(replyBatchSize);
      expect(thread?.empty).toBe(0);
    } finally {
      await harness.stop();
    }
  }, 90_000);

  /**
   * The bug a live run found and this file did not.
   *
   * The judgement asks "did the batch we bought last time hold a lead", and
   * the first version asked it of the batch it had *just* bought — which
   * nothing had classified yet. It counted zero every time, so every thread
   * died after three batches however good it was.
   *
   * No case here could see it, because each drove one batch and asserted the
   * row. The fault only appears when a batch is judged while a **later** batch
   * exists, so this case puts a match in batch one and then reads two more.
   */
  it("judges the batch that was classified, not the one it has just bought", async () => {
    const harness = await deepHarness("judging");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_judging");

      await harness.run(monitorId, [postId]);
      await until("batch one", () => harness.seen[0]);

      // A lead in batch one, which is what the next pass must find.
      const [first] = await harness.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.parentPostId, postId), eq(posts.threadPosition, 0)));

      await harness.db.insert(matches).values({
        monitorId,
        postId: first?.id as string,
        score: 80,
        relevance: 80,
        problemFit: 80,
        icpFit: 80,
        intent: 80,
        urgency: 50,
        intentType: "problem",
        reasons: ["A person describing the problem."],
      });

      await harness.run(monitorId, [postId]);
      await until("batch two", () => harness.seen[1]);

      const [afterTwo] = await harness.db
        .select({ empty: posts.repliesEmptyBatches, judged: posts.repliesJudgedTo })
        .from(posts)
        .where(eq(posts.id, postId));

      // Batch one held a lead, so the counter is zero and the mark has moved.
      expect(afterTwo?.empty).toBe(0);
      expect(afterTwo?.judged).toBe(replyBatchSize);

      // Batch two held none, so the next pass closes the thread. What this
      // case is really asserting is the pass before it: batch one's match was
      // found, which is the seam the first version of the rule got wrong.
      await harness.run(monitorId, [postId]);
      await until("the thread to close", async () => {
        const [row] = await harness.db
          .select({ stopped: posts.repliesStopped })
          .from(posts)
          .where(eq(posts.id, postId));
        return row?.stopped ?? undefined;
      });

      const [afterThree] = await harness.db
        .select({ empty: posts.repliesEmptyBatches, stopped: posts.repliesStopped })
        .from(posts)
        .where(eq(posts.id, postId));

      expect(afterThree?.empty).toBe(maxEmptyBatches);
      expect(afterThree?.stopped).toBe("threshold");
    } finally {
      await harness.stop();
    }
  }, 90_000);

  /**
   * Why a thread stopped growing, when the answer is money.
   *
   * Found by the first live run of the loop: the guard refused a batch and
   * returned, so nothing recorded the reason. A short thread then reads as a
   * judgement about the conversation when it was a judgement about the month,
   * which is the confusion the inbox sentence exists to prevent.
   */
  it("records a budget refusal on the threads it was reading", async () => {
    const harness = await deepHarness("budget");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_budget");
      const untouched = await insertThread(harness.db, "t3_batch_budget_untouched");

      // One batch in, then the money runs out.
      await harness.run(monitorId, [postId]);
      await until("batch one", () => harness.seen[0]);

      /**
       * A cap and enough recorded spend to pass it.
       *
       * The spend is written rather than incurred: the fake connector bills
       * nothing, so a cap alone would never be reached and the case would pass
       * for the wrong reason.
       */
      await harness.db
        .insert(budgets)
        .values({ monitorId, monthlyCapMicros: 1_000, onExhausted: "pause" });

      await harness.db.insert(apiUsage).values({
        userId: owner,
        monitorId,
        source: "reddit",
        provider: "scrapecreators",
        day: new Date().toISOString().slice(0, 10),
        units: 1,
        estimatedCostMicros: 5_000,
      });

      await harness.run(monitorId, [postId, untouched]);
      await until("the budget to be recorded", async () => {
        const [row] = await harness.db
          .select({ stopped: posts.repliesStopped })
          .from(posts)
          .where(eq(posts.id, postId));
        return row?.stopped ?? undefined;
      });

      const [read] = await harness.db
        .select({ stopped: posts.repliesStopped })
        .from(posts)
        .where(eq(posts.id, postId));

      expect(read?.stopped).toBe("budget");

      // A thread this job never opened has nothing to explain.
      const [other] = await harness.db
        .select({ stopped: posts.repliesStopped })
        .from(posts)
        .where(eq(posts.id, untouched));

      expect(other?.stopped).toBeNull();
    } finally {
      await harness.stop();
    }
  }, 90_000);

  it("stops at the ceiling, however well the thread is doing", async () => {
    const harness = await deepHarness("ceiling");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      // Start one batch below the ceiling, so the next batch reaches it.
      const postId = await insertThread(harness.db, "t3_batch_ceiling", {
        repliesBatchStart: maxCommentsPerThread - replyBatchSize,
        // Already judged up to here, so the threshold has nothing to say and
        // the ceiling is the only rule this case tests.
        repliesJudgedTo: maxCommentsPerThread - replyBatchSize,
      });

      await harness.run(monitorId, [postId]);
      await until("the last allowed batch", () => harness.seen[0]);

      const [thread] = await harness.db
        .select({ stopped: posts.repliesStopped, batchStart: posts.repliesBatchStart })
        .from(posts)
        .where(eq(posts.id, postId));

      expect(thread?.batchStart).toBe(maxCommentsPerThread);
      // The ceiling is what protects the bill, and it outranks a good yield.
      expect(thread?.stopped).toBe("ceiling");
    } finally {
      await harness.stop();
    }
  }, 60_000);

  it("never re-reads a thread the ceiling already closed", async () => {
    const harness = await deepHarness("ceiling_again");

    try {
      const monitorId = await insertMonitor(harness.database, { includeReplies: true });
      const postId = await insertThread(harness.db, "t3_batch_ceiling_done", {
        repliesBatchStart: maxCommentsPerThread,
      });

      await harness.run(monitorId, [postId]);
      await new Promise((resolve) => setTimeout(resolve, 700));

      const usage = await harness.db
        .select()
        .from(apiUsage)
        .where(eq(apiUsage.monitorId, monitorId));

      // Not one credit. A thread at its ceiling is not asked about again.
      expect(usage).toEqual([]);
    } finally {
      await harness.stop();
    }
  }, 60_000);
});
