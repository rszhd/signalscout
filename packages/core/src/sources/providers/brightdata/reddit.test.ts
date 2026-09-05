/**
 * The Reddit connector, driven against payloads captured from a live Bright
 * Data account by `fixtures/capture.mjs`.
 *
 * Nothing here reaches the network. The runtime's `fetch` is a stub that
 * replays the captured files, so a test that tried to collect anything would
 * fail rather than spend a record. docs/testing.md, *No test spends money*.
 *
 * The literals below were read out of the fixtures by eye. Re-running the
 * capture collects different posts and will change them; that is a deliberate
 * edit to make at the same time, not a reason to derive the expected values
 * from the code that produces them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { unreachableFetch } from "../../../testing/network.js";
import { redditPlatformId } from "../../platforms.js";
import { createSourceRegistry } from "../../registry.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { dateRangeFor } from "./client.js";
import { brightDataProviderId } from "./provider.js";
import { brightDataReddit, RedditSource, toCandidatePost } from "./reddit.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

const keywordRecords = fixture("posts-discover-by-keyword-records") as Record<string, unknown>[];
const subredditRecords = fixture("posts-discover-by-subreddit-records") as Record<
  string,
  unknown
>[];
const progressRunning = fixture("posts-discover-by-keyword-progress-running");
const progressReady = fixture("posts-discover-by-keyword-progress-ready");
const snapshotNotReady = fixture("posts-discover-by-keyword-snapshot-not-ready");
const triggerAnswer = fixture("posts-discover-by-keyword-trigger") as { snapshot_id: string };
const credentialsAccepted = fixture("credentials-accepted") as {
  httpStatus: number;
  body: unknown;
};
const credentialsRejected = fixture("credentials-rejected") as {
  httpStatus: number;
  body: unknown;
};

const now = new Date("2026-09-05T00:00:00.000Z");

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/**
 * A `fetch` that answers from the captured files.
 *
 * A queue per endpoint, where the last entry repeats. That is what lets one
 * test walk a snapshot from running to ready without describing every poll.
 */
function brightData(plan: { trigger?: Reply[]; progress?: Reply[]; snapshot?: Reply[] }) {
  const queues: Record<string, Reply[]> = {
    trigger: [...(plan.trigger ?? [])],
    progress: [...(plan.progress ?? [])],
    snapshot: [...(plan.snapshot ?? [])],
  };
  const calls: Call[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    const raw = init?.body;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    });

    const kind = url.includes("/trigger")
      ? "trigger"
      : url.includes("/progress/")
        ? "progress"
        : "snapshot";

    const queue = queues[kind] ?? [];
    if (queue.length === 0) throw new Error(`the test planned no ${kind} answer for ${url}`);
    const reply = queue.length === 1 ? queue[0] : queue.shift();

    return Promise.resolve(
      new Response(
        typeof reply?.body === "string" ? reply.body : JSON.stringify(reply?.body ?? null),
        { status: reply?.status ?? 200 },
      ),
    );
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "reddit-test" }),
  };
}

const credentials = { apiKey: "a-bright-data-key" };

/** The cursor grammar, written out here so a test reads as the caller sees it. */
function cursorAt(phase: "keyword" | "subreddit", offset = 0) {
  return `${phase}|${triggerAnswer.snapshot_id}|${offset}`;
}

function searchRequest(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["playwright tests keep breaking"], channels: [] },
    credentials,
    ...overrides,
  };
}

/** The three answers a full collection gives, in the order it gives them. */
function collectionPlan() {
  return {
    trigger: [{ status: 200, body: triggerAnswer }],
    progress: [
      { status: 200, body: progressRunning },
      { status: 200, body: progressReady },
    ],
    snapshot: [{ status: 200, body: keywordRecords }],
  };
}

describe("a captured record becomes a candidate post", () => {
  it("reads the fields posts has a column for, and no others", () => {
    const post = toCandidatePost(keywordRecords[0]);

    expect(post).toEqual({
      externalId: "t3_1vvuwfy",
      url: "https://www.reddit.com/r/learnpython/comments/1vvuwfy/playwright_button_is_clicked_but_doesnt_continue/",
      author: "redditor-1",
      channel: "learnpython",
      title: "(Playwright) Button is clicked, but doesn't continue",
      text: keywordRecords[0]?.description,
      postedAt: new Date("2026-08-23T02:22:56.940Z"),
    });
  });

  it("keeps nothing the provider sent beyond those fields", () => {
    // The record carries karma, community rank, an avatar and a bio. Honouring
    // a deletion is cheap only while we hold little, so this asserts the
    // absence, not just the presence. STACK.md, *Honor deletions*.
    const post = toCandidatePost(keywordRecords[0]) as unknown as Record<string, unknown>;

    expect(Object.keys(post).sort()).toEqual([
      "author",
      "channel",
      "externalId",
      "postedAt",
      "text",
      "title",
      "url",
    ]);
  });

  it("maps every captured record, from both discovery modes", () => {
    for (const record of [...keywordRecords, ...subredditRecords]) {
      expect(toCandidatePost(record)).toBeDefined();
    }
  });

  it("drops a record it could not store or deduplicate", () => {
    // `include_errors=true` lets a record describe a failure instead of a post.
    // Without an id there is nothing for `UNIQUE (source, external_id)` to
    // hold, so the row would be re-fetched and re-billed every poll.
    expect(toCandidatePost({ ...keywordRecords[0], post_id: undefined })).toBeUndefined();
    expect(toCandidatePost({ ...keywordRecords[0], url: undefined })).toBeUndefined();
    expect(toCandidatePost({ ...keywordRecords[0], date_posted: "not a date" })).toBeUndefined();
    expect(toCandidatePost({ error: "dead page", error_code: 404 })).toBeUndefined();
    expect(toCandidatePost(null)).toBeUndefined();
  });

  it("gives a link post its title to be read, rather than nothing", () => {
    const post = toCandidatePost({ ...keywordRecords[0], description: "" });

    expect(post?.text).toBe("(Playwright) Button is clicked, but doesn't continue");
  });
});

describe("a collection is started, waited for, and read once", () => {
  it("hands the wait back instead of holding the worker", async () => {
    const provider = brightData(collectionPlan());
    const source = new RedditSource(runtimeWith(provider.fetch));

    const first = await source.search(searchRequest());

    expect(first.posts).toEqual([]);
    // A trigger collects nothing, so it bills nothing. The charge belongs to
    // the page that reads the finished snapshot.
    expect(first.unitsConsumed).toBe(0);
    expect(first.next).toEqual({
      status: "wait",
      retryAfter: new Date("2026-09-05T00:00:30.000Z"),
      cursor: cursorAt("keyword"),
    });
  });

  it("waits again while the snapshot is still running, and bills nothing", async () => {
    const provider = brightData(collectionPlan());
    const source = new RedditSource(runtimeWith(provider.fetch));

    const waiting = await source.search(searchRequest({ cursor: cursorAt("keyword") }));

    expect(waiting.posts).toEqual([]);
    expect(waiting.unitsConsumed).toBe(0);
    expect(waiting.next.status).toBe("wait");
  });

  it("returns the posts when the snapshot is ready, and then says done", async () => {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const page = await source.search(searchRequest({ cursor: cursorAt("keyword") }));

    expect(page.posts.map((post) => post.externalId)).toEqual([
      "t3_1vvuwfy",
      "t3_1vydwa6",
      "t3_1vsozsw",
      "t3_1vx2j3t",
      "t3_1w0n9hi",
    ]);
    expect(page.next).toEqual({ status: "done" });
  });

  it("bills what the provider says it collected, not what the page returned", async () => {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    // Two posts asked for, five records collected and billed. Bright Data
    // charges per record at collection time, so a caller that counted the page
    // would under-report the charge by three records every poll.
    const page = await source.search(searchRequest({ cursor: cursorAt("keyword"), limit: 2 }));

    expect(page.posts).toHaveLength(2);
    expect(page.unitsConsumed).toBe(5);
  });

  it("waits when the snapshot is ready but not yet servable", async () => {
    // A real state: the progress endpoint says ready and the download endpoint
    // answers with an object carrying its own retry hint. Parsing that object
    // as an empty array would report the query finished and lose five posts.
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
      snapshot: [{ status: 200, body: snapshotNotReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const page = await source.search(searchRequest({ cursor: cursorAt("keyword") }));

    expect(page.posts).toEqual([]);
    expect(page.next).toEqual({
      status: "wait",
      // "try again in 30s", read from the provider's own message rather than
      // guessed.
      retryAfter: new Date("2026-09-05T00:00:30.000Z"),
      cursor: cursorAt("keyword"),
    });
  });
});

describe("a cursor stops the same records being fetched or billed twice", () => {
  async function drain(limit: number) {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const ids: string[] = [];
    let billed = 0;
    let cursor: string | undefined = cursorAt("keyword");

    for (let page = 0; page < 20; page += 1) {
      const result = await source.search(searchRequest({ cursor, limit }));
      ids.push(...result.posts.map((post) => post.externalId));
      billed += result.unitsConsumed;

      if (result.next.status === "done") return { ids, billed, provider };
      if (result.next.status === "wait") throw new Error("the snapshot was ready");
      cursor = result.next.cursor;
    }

    throw new Error("the connector never finished paging");
  }

  it("returns each post once across pages, and bills the collection once", async () => {
    const { ids, billed } = await drain(2);

    expect(ids).toEqual(["t3_1vvuwfy", "t3_1vydwa6", "t3_1vsozsw", "t3_1vx2j3t", "t3_1w0n9hi"]);
    expect(new Set(ids).size).toBe(ids.length);
    // Five records were collected and billed once. Paging through them in
    // three pages must not charge for them three times.
    expect(billed).toBe(5);
  });

  it("never triggers a second collection while paging one", async () => {
    const { provider } = await drain(2);

    expect(provider.calls.filter((call) => call.url.includes("/trigger"))).toHaveLength(0);
  });

  it("collects the subreddits after the keywords, rather than never", async () => {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));
    const query = { queries: ["playwright tests keep breaking"], channels: ["QualityAssurance"] };

    const page = await source.search(searchRequest({ cursor: cursorAt("keyword"), query }));

    // The keyword snapshot is finished. Reporting `done` here would send the
    // caller back to the start, where it would collect the same keywords again
    // and never once ask for the subreddit the monitor named.
    expect(page.next).toEqual({
      status: "wait",
      retryAfter: new Date("2026-09-05T00:00:30.000Z"),
      cursor: cursorAt("subreddit"),
    });
    // The charge for the keyword collection still travels with this page.
    expect(page.unitsConsumed).toBe(5);
    expect(provider.calls.at(-1)?.body).toEqual([
      { url: "https://www.reddit.com/r/QualityAssurance/", sort_by: "New" },
    ]);
  });

  it("is done once every phase the monitor named has been read", async () => {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const page = await source.search(
      searchRequest({
        cursor: cursorAt("subreddit"),
        query: { queries: ["anything"], channels: ["QualityAssurance"] },
      }),
    );

    expect(page.next).toEqual({ status: "done" });
  });

  it("refuses a cursor it did not issue", async () => {
    const provider = brightData(collectionPlan());
    const source = new RedditSource(runtimeWith(provider.fetch));

    for (const invented of [
      "sd_abc",
      "keyword|sd_abc",
      "keyword|sd_abc|nonsense",
      "hot|sd_abc|0",
      "keyword|sd_abc|0|extra",
      "keyword||0",
      "keyword|sd_abc|-1",
    ]) {
      await expect(source.search(searchRequest({ cursor: invented }))).rejects.toThrow(
        `cursor "${invented}" was not issued by this source`,
      );
    }
  });
});

describe("the query decides what is asked for", () => {
  function triggerBodyFor(request: Partial<SearchRequest>) {
    const provider = brightData(collectionPlan());
    const source = new RedditSource(runtimeWith(provider.fetch));
    return source.search(searchRequest(request)).then(() => provider.calls[0]);
  }

  it("discovers by keyword, and asks for the narrowest window that covers since", async () => {
    const call = await triggerBodyFor({
      query: {
        queries: ["playwright tests keep breaking"],
        channels: [],
        since: new Date("2026-09-02T00:00:00.000Z"),
      },
      limit: 10,
    });

    expect(call?.url).toContain("discover_by=keyword");
    expect(call?.url).toContain("type=discover_new");
    expect(call?.body).toEqual([
      { keyword: "playwright tests keep breaking", date: "Past week", num_of_posts: 10 },
    ]);
  });

  it("discovers by subreddit when the monitor named channels and no queries", async () => {
    const call = await triggerBodyFor({
      query: { queries: [], channels: ["QualityAssurance"] },
    });

    expect(call?.url).toContain("discover_by=subreddit_url");
    expect(call?.body).toEqual([
      { url: "https://www.reddit.com/r/QualityAssurance/", sort_by: "New" },
    ]);
  });

  it("splits the caller's limit across inputs, so one poll cannot collect a multiple of it", async () => {
    const call = await triggerBodyFor({
      query: { queries: ["one", "two", "three", "four"], channels: [] },
      limit: 8,
    });

    // Four keywords, eight posts wanted: two each. Asking eight of each would
    // collect thirty-two records and bill for all of them.
    expect(call?.body).toEqual([
      { keyword: "one", date: "All time", num_of_posts: 2 },
      { keyword: "two", date: "All time", num_of_posts: 2 },
      { keyword: "three", date: "All time", num_of_posts: 2 },
      { keyword: "four", date: "All time", num_of_posts: 2 },
    ]);
  });

  it("asks for nothing, and spends nothing, when the query is empty", async () => {
    const provider = brightData(collectionPlan());
    const source = new RedditSource(runtimeWith(provider.fetch));

    const result = await source.search(searchRequest({ query: { queries: [], channels: [] } }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
    expect(provider.calls).toEqual([]);
  });

  it("drops posts older than since, which the provider's coarse window still returns", async () => {
    const provider = brightData({
      ...collectionPlan(),
      progress: [{ status: 200, body: progressReady }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const page = await source.search(
      searchRequest({
        cursor: cursorAt("keyword"),
        query: {
          queries: ["playwright tests keep breaking"],
          channels: [],
          since: new Date("2026-08-24T00:00:00.000Z"),
        },
      }),
    );

    // The two records dated 19 and 23 August are dropped; the three dated 24,
    // 25 and 28 August survive. "Past week" is the narrowest window Bright
    // Data offers, so the connector, not the provider, is what keeps the
    // caller's promise.
    expect(page.posts.map((post) => post.externalId)).toEqual([
      "t3_1vydwa6",
      "t3_1vx2j3t",
      "t3_1w0n9hi",
    ]);
  });
});

describe("the date range covers the caller's since", () => {
  it("picks the narrowest range that still reaches back far enough", () => {
    const at = (iso: string) => new Date(iso);

    expect(dateRangeFor(at("2026-09-04T12:00:00.000Z"), now)).toBe("Today");
    expect(dateRangeFor(at("2026-09-01T00:00:00.000Z"), now)).toBe("Past week");
    expect(dateRangeFor(at("2026-08-20T00:00:00.000Z"), now)).toBe("Past month");
    expect(dateRangeFor(at("2026-01-01T00:00:00.000Z"), now)).toBe("All time");
    expect(dateRangeFor(undefined, now)).toBe("All time");
  });

  it("rounds outwards, because a window too narrow drops posts silently", () => {
    // Exactly seven days old. "Past week" reaches it; "Today" would not, and
    // nobody would ever see what was lost.
    expect(dateRangeFor(new Date("2026-08-29T00:00:00.000Z"), now)).toBe("Past week");
  });

  it("does not widen a week to a month over a few milliseconds", () => {
    // BUG-002, seen live on 2026-09-05. A caller works out `since` from one
    // clock reading and this compares it against another, so "the last seven
    // days" arrives a moment over seven days. Without slack it bought a
    // month: the collection was billed ten records and returned posts three
    // weeks old, which the caller's own filter then dropped.
    expect(dateRangeFor(new Date("2026-08-28T23:59:59.000Z"), now)).toBe("Past week");
    expect(dateRangeFor(new Date("2026-08-28T23:56:00.000Z"), now)).toBe("Past week");
  });

  it("still widens for a window that is genuinely wider", () => {
    // The slack is minutes. A day past the boundary is a day, and asking for
    // "Past week" would silently drop everything between.
    expect(dateRangeFor(new Date("2026-08-28T00:00:00.000Z"), now)).toBe("Past month");
    expect(dateRangeFor(new Date("2026-09-03T23:00:00.000Z"), now)).toBe("Past week");
  });
});

describe("a key is checked without spending anything", () => {
  it("accepts a key the provider authenticated", async () => {
    const provider = brightData({
      trigger: [{ status: credentialsAccepted.httpStatus, body: credentialsAccepted.body }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    expect(await source.validateCredentials(credentials)).toEqual({ valid: true });
    // An empty input list cannot start a collection, so the check is free.
    expect(provider.calls[0]?.body).toEqual([]);
  });

  it("rejects a key the provider refused, and names what to fix", async () => {
    const provider = brightData({
      trigger: [{ status: credentialsRejected.httpStatus, body: credentialsRejected.body }],
    });
    const source = new RedditSource(runtimeWith(provider.fetch));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
    // A boolean would leave a user with nowhere to go. PLAN.md's sketch
    // returned one; US-003 replaced it with a sentence for this case.
    expect(check).toMatchObject({ reason: expect.stringContaining("REDDIT_API_KEY") });
  });

  it("says the field is empty rather than asking the provider", async () => {
    const source = new RedditSource(runtimeWith(unreachableFetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your Bright Data API key.",
    });
  });
});

describe("the connector is registered like any other", () => {
  it("ships in the build and prices itself per record", () => {
    const registry = createSourceRegistry({
      definitions: [brightDataReddit],
      runtime: runtimeWith(unreachableFetch),
    });

    const reddit = registry.get(redditPlatformId, brightDataProviderId);

    expect(reddit.platform.displayName).toBe("Reddit");
    expect(reddit.provider.displayName).toBe("Bright Data");
    // $1.50 per 1,000 records, and the unit is a record because Bright Data
    // bills each one. STACK.md, *Source economics*.
    expect(reddit.billableUnit).toBe("record");
    expect(reddit.pricePerUnitMicros).toBe(1500);
    expect(reddit.provider.credentialFields).toEqual([
      { name: "apiKey", label: "Bright Data API key", secret: true },
    ]);
  });

  it("has a place in the posts table already, so it needs no migration", () => {
    expect(() => assertSourcesCanBeStored([redditPlatformId])).not.toThrow();
  });
});
