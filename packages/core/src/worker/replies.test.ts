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
import { apiUsage, posts } from "../db/schema.js";
import { createLogger } from "../logger.js";
import type { CandidateReply } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import type { ClassifyPayload, FilterPayload } from "./queues.js";
import { repliesQueue } from "./queues.js";
import { maxPagesPerThread } from "./replies.js";
import { startWorker, type WorkerHandle } from "./runtime.js";
import { fakeRegistry, fastRetries, insertMonitor, until } from "./testing.js";

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
