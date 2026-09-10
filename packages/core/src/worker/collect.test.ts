import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setBudget } from "../budget/budget.js";
import { createDatabase, type Database } from "../db/client.js";
import {
  apiUsage,
  maxResumeAttempts,
  monitors,
  posts,
  sourceContinuations,
  sourceCoverage,
  sourceProviders,
} from "../db/schema.js";
import { setProviderChoice } from "../sources/choices.js";
import { fakePosts } from "../sources/fake/fixtures.js";
import type { FakeSourceOptions } from "../sources/fake/index.js";
import { fakeSourceDefinition } from "../sources/fake/index.js";
import { createSourceRegistry } from "../sources/registry.js";
import { createSourceRuntime } from "../sources/runtime.js";
import type { CandidatePost, SearchRequest, SocialSource } from "../sources/types.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { unreachableFetch } from "../testing/network.js";
import { createCollectStep, excerptLength, maxPagesPerPoll } from "./collect.js";
import type { CredentialLookup } from "./credentials.js";
import { filterQueue, pollQueue } from "./queues.js";
import type { StepContext } from "./steps.js";
import { fakeRegistry, insertMonitor, silentLogger, twoProviderRegistry } from "./testing.js";

/**
 * The poll step, driven without a queue.
 *
 * The source is the fake connector, whose runtime is given a `fetch` that
 * cannot reach anything, so "this test spends no money" is a property of the
 * setup and not a claim about the code.
 */
const credentials: CredentialLookup = () => ({ token: "test-token" });

function stubBoss() {
  return {
    send: vi.fn(async (_queue: string, _payload: unknown, _options?: unknown) => "job-1"),
  };
}

/** What the step handed to a queue, or a failure that says which queue was silent. */
function sentTo(boss: ReturnType<typeof stubBoss>, queue: string): { postIds: string[] } {
  const call = boss.send.mock.calls.find(([name]) => name === queue);

  if (!call) throw new Error(`Nothing was sent to the ${queue} queue.`);

  return call[1] as { postIds: string[] };
}

/** The poll job the step booked for itself, or a failure saying none was. */
function pollSend(boss: ReturnType<typeof stubBoss>): [string, unknown, { startAfter?: Date }] {
  const call = boss.send.mock.calls.find(([name]) => name === pollQueue);

  if (!call) throw new Error("No poll job was booked.");

  return call as unknown as [string, unknown, { startAfter?: Date }];
}

function contextFor(db: Database, boss: ReturnType<typeof stubBoss>): StepContext {
  return { db, boss: boss as unknown as StepContext["boss"], logger: silentLogger };
}

/** Every search the fake served, in order. An empty list means it was never asked. */
function callsOf(registry: ReturnType<typeof fakeRegistry>): readonly SearchRequest[] {
  return (registry.only("reddit") as SocialSource & { calls: readonly SearchRequest[] }).calls;
}

describe("the poll step", () => {
  let database: TestDatabase;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createTestDatabase("worker_collect");
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

  it("stores what the source returned and hands the ids to the filter step", async () => {
    const monitorId = await insertMonitor(database);
    const boss = stubBoss();
    const registry = fakeRegistry();

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, boss),
    );

    const stored = await db.select().from(posts);

    expect(stored).toHaveLength(fakePosts.length);
    expect(stored.map((post) => post.externalId).sort()).toEqual(
      fakePosts.map((post) => post.externalId).sort(),
    );
    expect(stored.every((post) => post.source === "reddit")).toBe(true);

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(sentTo(boss, filterQueue).postIds).toHaveLength(fakePosts.length);
  });

  it("stores one row when a poll finds the same post twice", async () => {
    /**
     * Correctness-critical: cursor and deduplication. BUG-015.
     *
     * A poll builds one `INSERT` from every post every source returned, and
     * Postgres rejects a statement whose own rows collide:
     *
     *     ON CONFLICT DO UPDATE command cannot affect row a second time
     *
     * It is not a partial failure. The whole statement is refused, so a poll
     * that collected a hundred posts stores none of them and has already paid
     * the provider for every page.
     *
     * The scoped Reddit search makes this ordinary rather than rare: five
     * queries across eight subreddits is forty searches, and a post matching
     * two of those queries comes back twice into one batch.
     */
    const monitorId = await insertMonitor(database);
    const boss = stubBoss();
    const first = fakePosts[0] as CandidatePost;
    const registry = fakeRegistry({ posts: [first, first, fakePosts[1] as CandidatePost] });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, boss),
    );

    const stored = await db.select().from(posts);

    // Two posts, not three and not none.
    expect(stored.map((post) => post.externalId).sort()).toEqual(
      [first.externalId, fakePosts[1]?.externalId].sort(),
    );

    // And the post that arrived twice is handed on once, not twice: the
    // filter step pays a model for every id it is given.
    const handed = sentTo(boss, filterQueue).postIds;
    expect(handed).toHaveLength(2);
    expect(new Set(handed).size).toBe(2);
  });

  it("keeps two platforms' posts that happen to share an id", async () => {
    /**
     * The other half of BUG-015's key. `(source, external_id)` is the unique
     * index, so deduplicating on the id alone would silently drop one
     * platform's post because another platform numbers a post the same way.
     * Reddit's ids are `t3_…` and X's are bare numbers today, and nothing in
     * the schema promises they stay apart.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
          posts: [fakePosts[0] as CandidatePost],
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
          posts: [fakePosts[0] as CandidatePost],
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"] },
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const stored = await db.select().from(posts);

    expect(stored.map((post) => post.source).sort()).toEqual(["reddit", "x"]);
  });

  it("stores what one platform collected when another platform's provider fails", async () => {
    /**
     * BUG-016, found live. SocialCrawl answered 503 for X — "twitter is
     * temporarily unavailable, your credits have been refunded" — the
     * connector threw, and `collect` never reached its insert. Reddit's pages
     * had already been fetched, parsed and paid for, and they went with it.
     * SocialCrawl refunded X's credits; nobody refunded Reddit's.
     *
     * Retrying makes it worse rather than better: the retry resumes the Reddit
     * walk, buys more pages, and throws again while the outage lasts.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const down = registry.only("x") as unknown as { search: () => Promise<never> };
    down.search = async () => {
      throw new Error("SocialCrawl answered 503: twitter is temporarily unavailable.");
    };

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["flaky tests"], x: ["flaky tests"] },
    });
    const boss = stubBoss();

    // The poll finishes. One platform being down is not the monitor's failure.
    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, boss),
    );

    const stored = await db.select().from(posts);

    expect(stored).toHaveLength(fakePosts.length);
    expect(stored.every((post) => post.source === "reddit")).toBe(true);
    expect(sentTo(boss, filterQueue).postIds).toHaveLength(fakePosts.length);
  });

  it("starts a new walk where the last one finished, not where the last poll ran", async () => {
    /**
     * BUG-017, and it cost $0.666 on the production instance.
     *
     * `monitors.last_polled_at` answers two questions: when a job last ran,
     * which the interval needs, and how far our collection already reaches,
     * which the window needs. It moves at the start of **every** poll,
     * including the resumes of a walk still being paged. So when one walk ends
     * and the next begins, that mark is minutes fresh while the walk's own
     * coverage ended long before — and the new walk is given a window as
     * narrow as the gap between two polls.
     *
     * On Reddit a walk is forty (query, subreddit) pairs at five pages a poll,
     * so it takes eight polls and re-books itself immediately. Every page of
     * the next walk is then bought and dropped by our own `since` filter.
     */
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...(fakePosts[0] as CandidatePost),
      externalId: `walk-${index}`,
      url: `https://example.test/walk/${index}`,
    }));

    // One post a page, so seven posts is more than `maxPagesPerPoll` and the
    // walk has to span two polls.
    const registry = fakeRegistry({ posts: many, pageSize: 1 });
    const monitorId = await insertMonitor(database);

    const step = createCollectStep({ registry, credentialsFor: credentials });

    const firstWalkStarted = new Date();
    await step({ monitorId }, contextFor(db, stubBoss()));

    // The walk is not finished: the page cap stopped it with a cursor.
    expect(
      await db
        .select()
        .from(sourceContinuations)
        .where(eq(sourceContinuations.monitorId, monitorId)),
    ).toHaveLength(1);

    const secondPollStarted = new Date();
    await step({ monitorId }, contextFor(db, stubBoss()));

    // Read to the end, so the walk is over and its coverage is what counts.
    expect(
      await db
        .select()
        .from(sourceContinuations)
        .where(eq(sourceContinuations.monitorId, monitorId)),
    ).toHaveLength(0);

    await step({ monitorId }, contextFor(db, stubBoss()));

    const asked = callsOf(registry);
    const newWalk = asked[asked.length - 1]?.query.since;

    // The third poll opens a new walk. Its window is where the finished walk
    // began — not the second poll, which was that same walk still paging.
    expect(newWalk).toBeDefined();
    expect(newWalk?.getTime()).toBeLessThan(secondPollStarted.getTime());
    expect(newWalk?.getTime()).toBeGreaterThanOrEqual(firstWalkStarted.getTime() - 1000);
  });

  it("does not move the coverage mark while a walk is still paging", async () => {
    /**
     * BUG-017's other half, and the one that makes the first half true. If a
     * resume advanced the mark, the walk would be marking itself covered as it
     * went — which is the same fault as reading `last_polled_at`, wearing a
     * new column.
     */
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...(fakePosts[0] as CandidatePost),
      externalId: `paging-${index}`,
      url: `https://example.test/paging/${index}`,
    }));

    const registry = fakeRegistry({ posts: many, pageSize: 1 });
    const monitorId = await insertMonitor(database);
    const step = createCollectStep({ registry, credentialsFor: credentials });

    await step({ monitorId }, contextFor(db, stubBoss()));

    // The page cap stopped it, so the walk is not finished and nothing is
    // covered yet — not even the pages it did read.
    expect(
      await db.select().from(sourceCoverage).where(eq(sourceCoverage.monitorId, monitorId)),
    ).toHaveLength(0);

    await step({ monitorId }, contextFor(db, stubBoss()));

    // Now it is finished, and one row appears.
    expect(
      await db.select().from(sourceCoverage).where(eq(sourceCoverage.monitorId, monitorId)),
    ).toHaveLength(1);
  });

  it("asks each platform with the queries written for it", async () => {
    /**
     * US-027. A monitor holds one list of queries per platform, and the poll
     * hands each connector its own list and no other.
     *
     * The measurement behind it: US-006 sent a six-word Reddit phrase to a
     * live X search and got anime and Bitcoin posts unquoted, and nothing at
     * all quoted. Two words returned twenty posts, all on topic. So a list
     * that reaches the wrong platform either buys noise or buys nothing.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: {
        reddit: ["manual qa before every release"],
        x: ["flaky tests"],
      },
      generatedSubreddits: [],
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const asked = (platform: string) =>
      (registry.only(platform) as SocialSource & { calls: readonly SearchRequest[] }).calls;

    expect(asked("reddit")[0]?.query.queries).toEqual(["manual qa before every release"]);
    expect(asked("x")[0]?.query.queries).toEqual(["flaky tests"]);

    // The point of the ticket, stated as the thing that must not happen.
    expect(asked("x")[0]?.query.queries).not.toContain("manual qa before every release");
  });

  it("skips a platform this build does not offer, and collects the rest", async () => {
    /**
     * US-053. A monitor written before a connector was switched off still names
     * its platform. The job is not failed over it: a decision somebody made
     * about a connector is not an error, and failing here would retry four
     * times and then bury a monitor's other platforms in a dead letter queue.
     *
     * The connector is still registered and still built. What it is not is
     * offered, so nothing new is bought through it.
     */
    const registry = createSourceRegistry({
      definitions: [
        fakeSourceDefinition({
          id: "reddit",
          displayName: "Reddit",
          providerId: "brightdata",
          providerName: "Bright Data",
        }),
        fakeSourceDefinition({
          id: "x",
          displayName: "X",
          providerId: "socialcrawl",
          providerName: "SocialCrawl",
          notOffered: "X through SocialCrawl is switched off: nothing has measured it.",
        }),
      ],
      runtime: createSourceRuntime({ fetch: unreachableFetch, logger: silentLogger }),
    });

    const monitorId = await insertMonitor(database, {
      sources: ["reddit", "x"],
      generatedQueries: { reddit: ["manual qa before every release"], x: ["flaky tests"] },
      generatedSubreddits: [],
    });

    await expect(
      createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      ),
    ).resolves.toBeUndefined();

    const switchedOff = registry.get("x", "socialcrawl") as SocialSource & {
      calls: readonly SearchRequest[];
    };

    expect(switchedOff.calls).toHaveLength(0);
    expect((await db.select().from(apiUsage)).map((row) => row.source)).toEqual(["reddit"]);

    // The other platform is collected exactly as before.
    const stored = await db.select().from(posts);
    expect(stored).toHaveLength(fakePosts.length);
    expect(stored.every((post) => post.source === "reddit")).toBe(true);
  });

  it("gives a monitor written before the split the same queries it had", async () => {
    // Migration 0021 keys each row by the platforms its monitor watches, and a
    // monitor naming none keeps its array. Such a row still polls, with
    // exactly the queries a person last saw.
    const registry = fakeRegistry();
    const monitorId = await insertMonitor(database, {
      generatedQueries: ["flaky end to end tests"],
      generatedSubreddits: [],
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    expect(callsOf(registry)[0]?.query.queries).toEqual(["flaky end to end tests"]);
  });

  it("stores one row for a post two providers both collected", async () => {
    /**
     * Correctness-critical: deduplication. `posts` is keyed by
     * `(source, external_id)` and the provider sits outside that key, so the
     * same Reddit post fetched through Bright Data and through ScrapeCreators
     * is one row and is classified once.
     *
     * US-025 made this reachable: until Reddit had a second provider, no
     * deployment could collect one post twice. Both connectors read Reddit's
     * own `t3_` fullname as the id, which is what makes the keys collide —
     * `providers/scrapecreators/reddit.test.ts` asserts that half against the
     * captured payloads of both providers.
     */
    const monitorId = await insertMonitor(database);

    const collected: CandidatePost[] = [
      {
        externalId: "t3_1w71bul",
        url: "https://www.reddit.com/r/softwaretesting/comments/1w71bul/",
        text: "Starting automation from zero as a QA lead.",
        postedAt: new Date("2026-09-04T11:08:36.000Z"),
      },
    ];

    for (const providerId of ["brightdata", "scrapecreators"]) {
      const registry = fakeRegistry({ posts: collected, providerId });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );
    }

    const stored = await db.select().from(posts);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("reddit");
    expect(stored[0]?.externalId).toBe("t3_1w71bul");
    // Attribution keeps whichever provider stored it first. It is outside the
    // key on purpose: it says where the row came from, and it must never
    // decide whether the row is the same post.
    expect(stored[0]?.provider).toBe("brightdata");
  });

  it("pages until the source says it is done, and never on the page length", async () => {
    // Two posts a page, five posts. A caller that stopped when a page came
    // back shorter than the last would keep two of the five.
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({ pageSize: 2 });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
  });

  it("stops at the page cap rather than spending without a limit", async () => {
    const many: CandidatePost[] = Array.from({ length: 40 }, (_, index) => ({
      externalId: `bulk-${index}`,
      url: `https://example.test/bulk/${index}`,
      text: `Post number ${index}`,
      postedAt: new Date("2026-08-10T09:00:00.000Z"),
    }));

    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({ posts: many, pageSize: 1 });
    const source = registry.only("reddit") as SocialSource & { calls: readonly unknown[] };

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    // The cap, not the forty posts behind it. US-013's budget cap limits what
    // a monitor spends in a month; this limits how far one poll can carry it
    // past that, which is the part a monthly cap cannot do on its own.
    expect(source.calls).toHaveLength(maxPagesPerPoll);
    expect(await db.select().from(posts)).toHaveLength(maxPagesPerPoll);
  });

  it("stops when the source asks to be called back later", async () => {
    const monitorId = await insertMonitor(database);
    // One search, then the allowance is gone and the connector reports a wait.
    const registry = fakeRegistry({ pageSize: 1, callsBeforeRateLimit: 1 });
    const source = registry.only("reddit") as SocialSource & { calls: readonly unknown[] };

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    // Two calls: the one that was served, and the one that was told to wait.
    // Holding the job open for the window would block a worker slot and, on a
    // long window, expire the job.
    expect(source.calls).toHaveLength(2);
    expect(await db.select().from(posts)).toHaveLength(1);
  });

  it("skips a source with no credentials instead of failing the job", async () => {
    // A missing key is not transient. Failing here would retry four times and
    // then bury the one sentence the user has to read in a dead letter queue.
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const source = registry.only("reddit") as SocialSource & { calls: readonly unknown[] };
    const boss = stubBoss();

    await expect(
      createCollectStep({ registry, credentialsFor: () => undefined })(
        { monitorId },
        contextFor(db, boss),
      ),
    ).resolves.toBeUndefined();

    expect(source.calls).toHaveLength(0);
    expect(boss.send).not.toHaveBeenCalled();
    expect(await db.select().from(posts)).toHaveLength(0);
  });

  it("moves the poll mark forward and asks the next poll only for what is newer", async () => {
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry();
    const source = registry.only("reddit") as SocialSource & {
      calls: readonly { query: { since?: Date } }[];
    };
    const collect = createCollectStep({ registry, credentialsFor: credentials });

    await collect({ monitorId }, contextFor(db, stubBoss()));

    const [afterFirst] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
    const [covered] = await db
      .select()
      .from(sourceCoverage)
      .where(eq(sourceCoverage.monitorId, monitorId));

    expect(source.calls[0]?.query.since).toBeUndefined();
    // The interval's mark still moves, and it is not the window. BUG-017.
    expect(afterFirst?.lastPolledAt).not.toBeNull();
    // The first walk finished, so its platform is covered to where it began.
    expect(covered?.coveredThrough).toBeDefined();

    await collect({ monitorId }, contextFor(db, stubBoss()));

    // The second poll asks from where the first walk got to. Without this every
    // poll re-reads the whole window, and on X every re-read is billed.
    expect(source.calls[1]?.query.since?.getTime()).toBe(covered?.coveredThrough?.getTime());
  });

  it("stores a post once, and still gives its id to a second monitor", async () => {
    const first = await insertMonitor(database);
    const second = await insertMonitor(database, { name: "Second monitor" });
    const registry = fakeRegistry();
    const collect = createCollectStep({ registry, credentialsFor: credentials });

    const firstBoss = stubBoss();
    const secondBoss = stubBoss();

    await collect({ monitorId: first }, contextFor(db, firstBoss));
    await collect({ monitorId: second }, contextFor(db, secondBoss));

    // One row per post, however many monitors saw it. The unique constraint is
    // the last defence when the cursor logic fails.
    expect(await db.select().from(posts)).toHaveLength(fakePosts.length);

    // And the second monitor still gets every id. Returning only the newly
    // inserted rows would drop a post out of the second monitor's pipeline
    // for good, because it was already stored by the first.
    expect(sentTo(secondBoss, filterQueue).postIds).toHaveLength(fakePosts.length);
  });

  /**
   * The one field a second collection refreshes, and why it is the only one.
   *
   * US-020's re-open rule buys a thread again only when the platform's reply
   * count has grown. A live run on 2026-09-06 found the rule inert: the count
   * was frozen at whatever the first collection stored, so a conversation that
   * gained twenty replies looked exactly like one that gained none.
   *
   * Refreshing it is safe where refreshing the text is not. A counter cannot
   * resurrect words an author removed, which is the failure US-015 exists to
   * prevent and the reason every other field here stays put.
   */
  it("refreshes the reply count on a second collection, but not the text", async () => {
    // Two monitors rather than two polls of one: the second poll of a monitor
    // carries a `since` from the first, and the fake would return nothing.
    const monitorId = await insertMonitor(database);
    const later = await insertMonitor(database, { name: "Sees the thread later" });
    const post = {
      externalId: "growing-1",
      url: "https://example.test/growing/1",
      text: "The original words.",
      postedAt: new Date("2026-08-10T09:00:00.000Z"),
    };

    await createCollectStep({
      registry: fakeRegistry({ posts: [{ ...post, replyCount: 2 }] }),
      credentialsFor: credentials,
    })({ monitorId }, contextFor(db, stubBoss()));

    await createCollectStep({
      registry: fakeRegistry({
        posts: [{ ...post, text: "Edited after the fact.", replyCount: 21 }],
      }),
      credentialsFor: credentials,
    })({ monitorId: later }, contextFor(db, stubBoss()));

    const [row] = await db.select().from(posts).where(eq(posts.externalId, "growing-1"));

    expect(row?.replyCount).toBe(21);
    // The text is deliberately stale. A poll that rewrote it could bring back
    // something the author had already taken down.
    expect(row?.excerpt).toBe("The original words.");
  });

  it("keeps a count an earlier collection gave us when a later one says nothing", async () => {
    const monitorId = await insertMonitor(database);
    const later = await insertMonitor(database, { name: "Sees it without a count" });
    const post = {
      externalId: "quiet-1",
      url: "https://example.test/quiet/1",
      text: "Words.",
      postedAt: new Date("2026-08-10T09:00:00.000Z"),
    };

    await createCollectStep({
      registry: fakeRegistry({ posts: [{ ...post, replyCount: 7 }] }),
      credentialsFor: credentials,
    })({ monitorId }, contextFor(db, stubBoss()));

    // A connector that omits the count must not erase one we already hold.
    await createCollectStep({
      registry: fakeRegistry({ posts: [post] }),
      credentialsFor: credentials,
    })({ monitorId: later }, contextFor(db, stubBoss()));

    const [row] = await db.select().from(posts).where(eq(posts.externalId, "quiet-1"));

    expect(row?.replyCount).toBe(7);
  });

  it("keeps an excerpt, not the whole post", async () => {
    // Reddit's terms require that content the author removed stops being
    // shown. The less we hold, the less there is to remove.
    const long = "x".repeat(excerptLength + 500);
    const monitorId = await insertMonitor(database);
    const registry = fakeRegistry({
      posts: [
        {
          externalId: "long-1",
          url: "https://example.test/long/1",
          text: long,
          postedAt: new Date("2026-08-10T09:00:00.000Z"),
        },
      ],
    });

    await createCollectStep({ registry, credentialsFor: credentials })(
      { monitorId },
      contextFor(db, stubBoss()),
    );

    const [stored] = await db.select().from(posts);

    expect(stored?.excerpt).toHaveLength(excerptLength);
  });

  it("does nothing when the monitor was deleted between the tick and the job", async () => {
    const boss = stubBoss();

    await expect(
      createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId: "00000000-0000-0000-0000-000000000000" },
        contextFor(db, boss),
      ),
    ).resolves.toBeUndefined();

    expect(boss.send).not.toHaveBeenCalled();
  });

  /**
   * Correctness-critical: cursor and deduplication. Written before the fix.
   *
   * BUG-001. A Bright Data collection is asynchronous: the trigger answers
   * with a wait and a cursor, and the records exist only inside the snapshot
   * that cursor names. A poll that drops the cursor pays for a collection
   * nobody reads, and the next poll pays again for the same query. The first
   * live run did exactly that.
   *
   * The fake reports a wait the same way a metered source does, so these drive
   * the caller's half without a network and without a bill.
   */
  describe("a collection the source asked us to come back for", () => {
    function continuationsFor(monitorId: string) {
      return db
        .select()
        .from(sourceContinuations)
        .where(eq(sourceContinuations.monitorId, monitorId));
    }

    /** Serves one post of the five, then reports a wait carrying its cursor. */
    function waitingRegistry() {
      return fakeRegistry({ pageSize: 1, callsBeforeRateLimit: 1 });
    }

    /**
     * The provider's wait, over.
     *
     * Moving the stored deadline is how this file says time passed. Sleeping
     * out the fake's real window would hold the suite for a minute and would
     * be a race rather than an ordering: docs/testing.md, *A wait in
     * milliseconds is a race*.
     */
    async function theWaitIsOver(monitorId: string) {
      await db
        .update(sourceContinuations)
        .set({ resumeAfter: new Date(Date.now() - 1000) })
        .where(eq(sourceContinuations.monitorId, monitorId));
    }

    async function poll(
      registry: ReturnType<typeof fakeRegistry>,
      monitorId: string,
      boss = stubBoss(),
    ) {
      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, boss),
      );
      return boss;
    }

    it("keeps the cursor the source issued, and books the resume for when it said", async () => {
      const monitorId = await insertMonitor(database);
      const before = Date.now();

      const boss = await poll(waitingRegistry(), monitorId);

      // "1" is the fake's own cursor after one post of five. Stored unread:
      // the job that holds it in memory is over.
      const [continuation] = await continuationsFor(monitorId);

      expect(continuation?.source).toBe("reddit");
      expect(continuation?.cursor).toBe("1");
      expect(continuation?.attempts).toBe(0);
      expect(continuation?.resumeAfter.getTime()).toBeGreaterThan(before);

      const [, payload, options] = pollSend(boss);

      expect(payload).toEqual({ monitorId });
      expect(options.startAfter?.getTime()).toBe(continuation?.resumeAfter.getTime());
    });

    it("resumes from the stored cursor instead of collecting the query again", async () => {
      const monitorId = await insertMonitor(database);

      await poll(waitingRegistry(), monitorId);
      await theWaitIsOver(monitorId);

      // A second process: a new registry, a new source, a new step. Nothing is
      // carried in memory from the poll that started the collection, so what
      // the resume knows it read from the database.
      const registry = fakeRegistry();
      await poll(registry, monitorId);

      // The cursor the first poll was given. Starting again would send
      // `undefined`, which on Bright Data is a second collection and a second
      // bill for a query already collected.
      expect(callsOf(registry)[0]?.cursor).toBe("1");
      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);

      // Read to the end, so there is nothing left to come back for.
      expect(await continuationsFor(monitorId)).toHaveLength(0);
    });

    it("stores each post once across the wait, and gives each id to the filter once", async () => {
      const monitorId = await insertMonitor(database);

      const first = await poll(waitingRegistry(), monitorId);
      await theWaitIsOver(monitorId);
      const second = await poll(fakeRegistry(), monitorId);

      const handed = [
        ...sentTo(first, filterQueue).postIds,
        ...sentTo(second, filterQueue).postIds,
      ];

      // A resume that re-read the pages before its cursor would classify and
      // bill the same post twice.
      expect(handed).toHaveLength(fakePosts.length);
      expect(new Set(handed).size).toBe(fakePosts.length);
    });

    it("asks the resumed collection for the window the trigger asked for", async () => {
      const lastPolledAt = new Date("2026-07-01T00:00:00.000Z");
      const monitorId = await insertMonitor(database, { lastPolledAt });

      // Where this platform's collection already reaches, which is what a
      // fresh walk is opened with since BUG-017. The poll mark beside it is
      // the interval's and no longer the window's.
      await db
        .insert(sourceCoverage)
        .values({ monitorId, source: "reddit", coveredThrough: lastPolledAt });

      await poll(waitingRegistry(), monitorId);

      const [continuation] = await continuationsFor(monitorId);
      expect(continuation?.since?.getTime()).toBe(lastPolledAt.getTime());

      await theWaitIsOver(monitorId);

      const registry = fakeRegistry();
      await poll(registry, monitorId);

      // Not the poll mark, which the trigger moved to now. Reading that column
      // here would ask for posts newer than the trigger and drop every record
      // the collection was paid for.
      expect(callsOf(registry)[0]?.query.since?.getTime()).toBe(lastPolledAt.getTime());
      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
    });

    it("does not touch the source while the wait it asked for is still running", async () => {
      const monitorId = await insertMonitor(database);
      const resumeAfter = new Date(Date.now() + 60 * 60 * 1000);

      await db
        .insert(sourceContinuations)
        .values({ monitorId, source: "reddit", provider: "brightdata", cursor: "1", resumeAfter });

      const registry = fakeRegistry();
      const boss = await poll(registry, monitorId);

      // A scheduler tick that reached the source here would start a second
      // collection for a snapshot already paid for. That is the cost half of
      // BUG-001.
      expect(callsOf(registry)).toHaveLength(0);
      expect(await db.select().from(posts)).toHaveLength(0);

      const [continuation] = await continuationsFor(monitorId);
      expect(continuation?.cursor).toBe("1");
      expect(continuation?.attempts).toBe(0);

      // The alarm is booked again, so a job lost between polls does not strand
      // the snapshot until the monitor's own interval comes round.
      expect(pollSend(boss)[2].startAfter?.getTime()).toBe(resumeAfter.getTime());
    });

    it("counts a resume that found the collection still not ready", async () => {
      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        provider: "brightdata",
        cursor: "1",
        resumeAfter: new Date(Date.now() - 1000),
      });

      // An allowance of nothing: every call reports a wait, carrying back the
      // cursor it was given.
      const registry = fakeRegistry({ callsBeforeRateLimit: 0 });
      const boss = await poll(registry, monitorId);

      expect(callsOf(registry)[0]?.cursor).toBe("1");

      const rows = await continuationsFor(monitorId);

      // One row, updated. A second row here is a second collection in flight.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.cursor).toBe("1");
      expect(pollSend(boss)[2].startAfter).toBeInstanceOf(Date);
    });

    it("continues from where the page cap stopped, rather than collecting again", async () => {
      // Twelve posts, one per page, five pages per poll. The pages behind the
      // cap are collected and billed already: a poll that dropped that cursor
      // would make the next one pay for the whole query a second time.
      const many: CandidatePost[] = Array.from({ length: 12 }, (_, index) => ({
        externalId: `paged-${index}`,
        url: `https://example.test/paged/${index}`,
        text: `Post number ${index}`,
        postedAt: new Date("2026-08-10T09:00:00.000Z"),
      }));

      const monitorId = await insertMonitor(database);
      const paged = () => fakeRegistry({ posts: many, pageSize: 1 });

      const boss = await poll(paged(), monitorId);

      const [stopped] = await continuationsFor(monitorId);

      expect(stopped?.cursor).toBe(String(maxPagesPerPoll));
      // Due at once. Nothing was refused by the source, so there is nothing to
      // wait for.
      expect(stopped?.resumeAfter.getTime()).toBeLessThanOrEqual(Date.now());
      expect(pollSend(boss)[2].startAfter).toBeInstanceOf(Date);

      const second = paged();
      await poll(second, monitorId);

      expect(callsOf(second)[0]?.cursor).toBe(String(maxPagesPerPoll));
      expect(await db.select().from(posts)).toHaveLength(2 * maxPagesPerPoll);

      await poll(paged(), monitorId);

      expect(await db.select().from(posts)).toHaveLength(many.length);
      expect(await continuationsFor(monitorId)).toHaveLength(0);
    });

    it("counts only the resumes in a row that brought nothing back", async () => {
      // A long collection read a page at a time must not be abandoned. The cap
      // is for a collection that never becomes ready, not for one that works.
      const many: CandidatePost[] = Array.from({ length: 12 }, (_, index) => ({
        externalId: `counted-${index}`,
        url: `https://example.test/counted/${index}`,
        text: `Post number ${index}`,
        postedAt: new Date("2026-08-10T09:00:00.000Z"),
      }));

      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        provider: "brightdata",
        cursor: "0",
        resumeAfter: new Date(Date.now() - 1000),
        attempts: maxResumeAttempts - 1,
      });

      await poll(fakeRegistry({ posts: many, pageSize: 1 }), monitorId);

      const [continuation] = await continuationsFor(monitorId);

      expect(continuation?.cursor).toBe(String(maxPagesPerPoll));
      expect(continuation?.attempts).toBe(0);
    });

    it("gives up on a collection that never becomes ready", async () => {
      const monitorId = await insertMonitor(database);

      await db.insert(sourceContinuations).values({
        monitorId,
        source: "reddit",
        provider: "brightdata",
        cursor: "1",
        resumeAfter: new Date(Date.now() - 1000),
        attempts: maxResumeAttempts,
      });

      const registry = fakeRegistry();
      const boss = await poll(registry, monitorId);

      // The row goes, so the next scheduled poll starts the query fresh rather
      // than the monitor waiting on a snapshot for ever. Nothing is resumed
      // and nothing is triggered inside this poll: giving up must not itself
      // spend money.
      expect(await continuationsFor(monitorId)).toHaveLength(0);
      expect(callsOf(registry)).toHaveLength(0);
      expect(boss.send).not.toHaveBeenCalled();
    });
  });
  /**
   * The budget guard, at its one call site.
   *
   * docs/testing.md: a rule is only as tested as its least-tested caller. The
   * rule itself is asserted in `budget/budget.test.ts`; what these assert is
   * that this step obeys it, and that it obeys it *before* it reaches a
   * source. A guard that refused after the call would have spent the money.
   */
  /**
   * Which provider fetches a platform, and when a change to that takes effect.
   *
   * US-026. A monitor names a platform and its row records no provider, so the
   * poll decides. Two rules carry money: the poll must not ask a question a
   * deployment has one answer to, and a changed choice must never reach a
   * collection that is already paid for and running.
   */
  describe("which provider fetches a platform", () => {
    /** The owner `insertMonitor` writes, and somebody else on the same box. */
    const monitorOwner = "user-1";
    const neighbour = "user-2";

    /** A key for these providers and no others. */
    function keysFor(...providerIds: string[]): CredentialLookup {
      return (connector) =>
        providerIds.includes(connector.provider.id) ? { token: "test-token" } : undefined;
    }

    /** Which providers each account holds a key for. BUG-010's tests need two. */
    function keysPerOwner(byOwner: Record<string, string[]>): CredentialLookup {
      return (connector, userId) =>
        byOwner[userId]?.includes(connector.provider.id) ? { token: "test-token" } : undefined;
    }

    const brightDataPosts: CandidatePost[] = [
      {
        externalId: "t3_from_brightdata",
        url: "https://www.reddit.com/r/softwaretesting/comments/t3_from_brightdata/",
        text: "Collected through Bright Data.",
        postedAt: new Date("2026-09-04T11:08:36.000Z"),
      },
    ];

    const scrapeCreatorsPosts: CandidatePost[] = [
      {
        externalId: "t3_from_scrapecreators",
        url: "https://www.reddit.com/r/softwaretesting/comments/t3_from_scrapecreators/",
        text: "Collected through ScrapeCreators.",
        postedAt: new Date("2026-09-04T11:09:36.000Z"),
      },
    ];

    function bothProviders(overrides: Record<string, FakeSourceOptions> = {}) {
      return twoProviderRegistry({
        brightdata: { posts: brightDataPosts, ...overrides.brightdata },
        scrapecreators: { posts: scrapeCreatorsPosts, ...overrides.scrapecreators },
      });
    }

    /** Every search one provider's connector served, in order. */
    function callsFor(
      registry: ReturnType<typeof twoProviderRegistry>,
      providerId: string,
    ): readonly SearchRequest[] {
      return (registry.get("reddit", providerId) as SocialSource & { calls: SearchRequest[] })
        .calls;
    }

    async function poll(
      registry: ReturnType<typeof twoProviderRegistry>,
      credentialsFor: CredentialLookup,
      monitorId: string,
      boss = stubBoss(),
    ) {
      await createCollectStep({ registry, credentialsFor })({ monitorId }, contextFor(db, boss));
      return boss;
    }

    afterEach(async () => {
      await db.delete(sourceProviders);
    });

    it("uses the one provider that has a key, and asks nothing", async () => {
      // The common deployment: the build ships two Reddit connectors and the
      // person holds one of the two accounts. There is nothing to choose, so
      // nothing is asked and nothing is stored in `source_providers`.
      const monitorId = await insertMonitor(database);
      const registry = bothProviders();

      await poll(registry, keysFor("brightdata"), monitorId);

      expect((await db.select().from(posts)).map((post) => post.externalId)).toEqual([
        "t3_from_brightdata",
      ]);
      expect(callsFor(registry, "scrapecreators")).toHaveLength(0);
      expect(await db.select().from(sourceProviders)).toHaveLength(0);
    });

    it("refuses the poll when both have a key and nobody has chosen", async () => {
      // Picking would spend money at a provider nobody named. The poll stops
      // instead, and it stops before either connector is reached, so the
      // refusal costs nothing.
      const monitorId = await insertMonitor(database);
      const registry = bothProviders();

      await poll(registry, keysFor("brightdata", "scrapecreators"), monitorId);

      expect(await db.select().from(posts)).toHaveLength(0);
      expect(await db.select().from(apiUsage)).toHaveLength(0);
      expect(callsFor(registry, "brightdata")).toHaveLength(0);
      expect(callsFor(registry, "scrapecreators")).toHaveLength(0);
    });

    it("uses the recorded provider when both have a key", async () => {
      const monitorId = await insertMonitor(database);
      const registry = bothProviders();

      await setProviderChoice(db, monitorOwner, "reddit", "scrapecreators");
      await poll(registry, keysFor("brightdata", "scrapecreators"), monitorId);

      expect((await db.select().from(posts)).map((post) => post.externalId)).toEqual([
        "t3_from_scrapecreators",
      ]);
      expect(callsFor(registry, "brightdata")).toHaveLength(0);
    });

    it("takes effect on the next collection, with no restart", async () => {
      /**
       * The choice is read per poll and not at boot. One step, one registry,
       * one process: only the row changes between the two polls, so what moved
       * the collection is the row and nothing else.
       */
      const monitorId = await insertMonitor(database);
      const registry = bothProviders();
      const keys = keysFor("brightdata", "scrapecreators");

      await setProviderChoice(db, monitorOwner, "reddit", "brightdata");
      await poll(registry, keys, monitorId);

      // The window, back where it was. This test is not about the window, and
      // leaving it would make the second poll ask only for posts newer than
      // the first walk — which is every fixture filtered away.
      //
      // Both marks, because BUG-017 separated them: `last_polled_at` is the
      // interval's and `source_coverage` is the window's.
      await db.update(monitors).set({ lastPolledAt: null }).where(eq(monitors.id, monitorId));
      await db.delete(sourceCoverage).where(eq(sourceCoverage.monitorId, monitorId));

      await setProviderChoice(db, monitorOwner, "reddit", "scrapecreators");
      await poll(registry, keys, monitorId);

      expect(callsFor(registry, "brightdata")).toHaveLength(1);
      expect(callsFor(registry, "scrapecreators")).toHaveLength(1);
      expect((await db.select().from(posts)).map((post) => post.externalId).sort()).toEqual([
        "t3_from_brightdata",
        "t3_from_scrapecreators",
      ]);
    });

    it("splits the month's spend by provider rather than merging it", async () => {
      // `api_usage` is keyed by the pair, so a switch leaves two rows and each
      // one is priced by the connector that ran. One row would price a month
      // of two accounts at one account's rate.
      const monitorId = await insertMonitor(database);
      const registry = twoProviderRegistry({
        brightdata: { posts: brightDataPosts, unitsPerCall: 4, pricePerUnitMicros: 1500 },
        scrapecreators: { posts: scrapeCreatorsPosts, unitsPerCall: 1, pricePerUnitMicros: 3760 },
      });
      const keys = keysFor("brightdata", "scrapecreators");

      await setProviderChoice(db, monitorOwner, "reddit", "brightdata");
      await poll(registry, keys, monitorId);

      await setProviderChoice(db, monitorOwner, "reddit", "scrapecreators");
      await poll(registry, keys, monitorId);

      const usage = await db.select().from(apiUsage).orderBy(apiUsage.provider);

      expect(usage.map((row) => [row.provider, row.units, row.estimatedCostMicros])).toEqual([
        ["brightdata", 4, 6000],
        ["scrapecreators", 1, 3760],
      ]);
    });

    it("resumes a collection through the provider that started it, whatever the choice now says", async () => {
      /**
       * Correctness-critical: cursor and deduplication. The cursor is a
       * snapshot id and it means nothing to another provider. Resuming Bright
       * Data's collection through ScrapeCreators would read a snapshot it has
       * never heard of, and on a provider that bills at collection time it
       * would also pay for the query a second time.
       *
       * So the switch takes effect on the *next* collection. The one already
       * running finishes where it started.
       */
      const monitorId = await insertMonitor(database);
      const keys = keysFor("brightdata", "scrapecreators");
      const registry = bothProviders({
        // One post of the collection, then a wait carrying the cursor.
        brightdata: { pageSize: 1, callsBeforeRateLimit: 1, posts: [...fakePosts] },
      });

      await setProviderChoice(db, monitorOwner, "reddit", "brightdata");
      await poll(registry, keys, monitorId);

      const [started] = await db
        .select()
        .from(sourceContinuations)
        .where(eq(sourceContinuations.monitorId, monitorId));

      expect(started?.provider).toBe("brightdata");
      expect(started?.cursor).toBe("1");

      // The person changes their mind while the snapshot is still collecting.
      await setProviderChoice(db, monitorOwner, "reddit", "scrapecreators");
      await db
        .update(sourceContinuations)
        .set({ resumeAfter: new Date(Date.now() - 1000) })
        .where(eq(sourceContinuations.monitorId, monitorId));

      // A second process: new connectors, nothing carried in memory. What the
      // resume knows about the provider it read from `source_continuations`.
      const resumed = bothProviders({ brightdata: { posts: [...fakePosts] } });
      await poll(resumed, keys, monitorId);

      // Bright Data was asked again, with its own cursor. ScrapeCreators was
      // never asked at all, so no cursor crossed a provider and nothing was
      // collected twice.
      expect(callsFor(resumed, "brightdata")[0]?.cursor).toBe("1");
      expect(callsFor(resumed, "scrapecreators")).toHaveLength(0);
      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
    });

    it("refuses rather than moving a running monitor to the other provider", async () => {
      // The chosen provider's key is gone. Collecting through the other one
      // would bill an account nobody picked, at a price nobody was shown.
      const monitorId = await insertMonitor(database);
      const registry = bothProviders();

      await setProviderChoice(db, monitorOwner, "reddit", "scrapecreators");
      await poll(registry, keysFor("brightdata"), monitorId);

      expect(await db.select().from(posts)).toHaveLength(0);
      expect(callsFor(registry, "brightdata")).toHaveLength(0);
    });

    describe("with two accounts on the instance", () => {
      it("polls each monitor through its own owner's choice", async () => {
        // BUG-010. One process, one registry, two monitors: the only thing
        // that differs between the two polls is whose row was read.
        const annas = await insertMonitor(database, { userId: monitorOwner });
        const bens = await insertMonitor(database, { userId: neighbour });
        const registry = bothProviders();
        const keys = keysFor("brightdata", "scrapecreators");

        await setProviderChoice(db, monitorOwner, "reddit", "brightdata");
        await setProviderChoice(db, neighbour, "reddit", "scrapecreators");

        await poll(registry, keys, annas);
        await poll(registry, keys, bens);

        expect(callsFor(registry, "brightdata")).toHaveLength(1);
        expect(callsFor(registry, "scrapecreators")).toHaveLength(1);
      });

      it("does not let a neighbour's choice stop a monitor that can run", async () => {
        /**
         * The whole of BUG-010, as the person on the receiving end meets it.
         *
         * Anna holds the Bright Data key alone, so her Reddit poll has one
         * connector that can run and needs no choice. Ben records
         * ScrapeCreators for himself. Read from a table keyed by the platform
         * alone, Anna's poll finds a recorded choice she has no key for — and
         * by US-026's rule a choice that cannot run is refused rather than
         * replaced, so her monitor stops. She was never asked, never told, and
         * nothing on her screens changed.
         */
        const annas = await insertMonitor(database, { userId: monitorOwner });
        const registry = bothProviders();

        await setProviderChoice(db, neighbour, "reddit", "scrapecreators");

        await poll(
          registry,
          keysPerOwner({ [monitorOwner]: ["brightdata"], [neighbour]: ["scrapecreators"] }),
          annas,
        );

        expect((await db.select().from(posts)).map((post) => post.externalId)).toEqual([
          "t3_from_brightdata",
        ]);
        expect(callsFor(registry, "scrapecreators")).toHaveLength(0);
      });
    });
  });

  describe("the budget guard", () => {
    it("reaches no source once the monthly cap is spent", async () => {
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry();
      const boss = stubBoss();

      // A cap of nothing is a monitor that may spend nothing, and it is the
      // cheapest way to say "the cap is reached" without spending first.
      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "pause" });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, boss),
      );

      expect(callsOf(registry)).toHaveLength(0);
      expect(await db.select().from(posts)).toHaveLength(0);
      // Nothing reached the filter either. A refused poll that still sent an
      // empty batch onward would spend model money on the way.
      expect(boss.send).not.toHaveBeenCalled();
    });

    it("leaves the poll mark alone when it refuses, because nothing was polled", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 0, onExhausted: "notify" });
      await createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));

      expect(monitor?.lastPolledAt).toBeNull();
    });

    it("polls a monitor that has a cap with room left in it", async () => {
      const monitorId = await insertMonitor(database);

      await setBudget(db, monitorId, { monthlyCapMicros: 1_000_000, onExhausted: "pause" });
      await createCollectStep({ registry: fakeRegistry(), credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      expect(await db.select().from(posts)).toHaveLength(fakePosts.length);
    });

    it("records what each page was billed, against the monitor and the source", async () => {
      // Two units a call, five posts, one post a page: five calls, ten units.
      // At a thousand micro-dollars a unit that is one cent.
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ pageSize: 1, unitsPerCall: 2, pricePerUnitMicros: 1000 });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [usage] = await db.select().from(apiUsage);

      expect(usage?.source).toBe("reddit");
      expect(usage?.units).toBe(10);
      expect(usage?.estimatedCostMicros).toBe(10_000);
    });

    it("records a poll that was billed and brought nothing back", async () => {
      /**
       * The lesson the live run of 2026-09-05 taught, as an assertion. A
       * monitor at the sixty-second floor triggered a collection every minute,
       * and each one billed records and returned no posts because everything
       * it found was older than the last poll. A ledger that only recorded
       * polls with posts in them would have shown that month as free.
       */
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ posts: [], unitsPerCall: 9, pricePerUnitMicros: 1500 });

      await createCollectStep({ registry, credentialsFor: credentials })(
        { monitorId },
        contextFor(db, stubBoss()),
      );

      const [usage] = await db.select().from(apiUsage);

      expect(await db.select().from(posts)).toHaveLength(0);
      expect(usage?.units).toBe(9);
      expect(usage?.estimatedCostMicros).toBe(13_500);
    });

    it("records the pages a poll was billed for before it threw", async () => {
      // The reason the ledger is written per page. Two pages came back and
      // were billed; the third throws. Both are on the bill either way.
      const monitorId = await insertMonitor(database);
      const registry = fakeRegistry({ pageSize: 1, unitsPerCall: 4, pricePerUnitMicros: 1000 });
      const source = registry.only("reddit") as SocialSource;
      const search = source.search.bind(source);
      let served = 0;

      source.search = async (request: SearchRequest) => {
        served += 1;
        if (served > 2) throw new Error("the provider hung up");
        return search(request);
      };

      await expect(
        createCollectStep({ registry, credentialsFor: credentials })(
          { monitorId },
          contextFor(db, stubBoss()),
        ),
      ).rejects.toThrow("the provider hung up");

      const [usage] = await db.select().from(apiUsage);

      expect(usage?.units).toBe(8);
    });
  });
});
