/**
 * The ScrapeCreators Reddit connector, driven against payloads captured from a
 * live account by `fixtures/capture.mjs` on 2026-09-05.
 *
 * Nothing here reaches the network. The runtime's `fetch` either replays the
 * captured files or is `unreachableFetch`, so a test that tried to collect
 * anything would fail rather than spend a credit. docs/testing.md, *No test
 * spends money*.
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
import { toCandidatePost as toBrightDataPost } from "../brightdata/reddit.js";
import { scrapeCreatorsProviderId } from "./provider.js";
import { ScrapeCreatorsRedditSource, scrapeCreatorsReddit, toCandidatePost } from "./reddit.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const searchPage1 = fixture("search-posts");
const searchPage2 = fixture("search-posts-page-2");
const subredditPage = fixture("subreddit-posts");
const unknownSubreddit = fixture("unknown-subreddit");
const credentialsAccepted = fixture("credentials-accepted");
const credentialsRejected = fixture("credentials-rejected");
const timeframeRejected = fixture("timeframe-rejected");

function bodyOf(captured: Captured): Record<string, unknown> {
  return captured.body as Record<string, unknown>;
}

/** Read out of `search-posts.json` and `subreddit-posts.json` by eye. */
const searchCursor = bodyOf(searchPage1).after as string;
const subredditCursor = bodyOf(subredditPage).after as string;
const firstSearchPostId = "t3_1w7w4ak";
const firstSubredditPostId = "t3_1w71bul";

const now = new Date("2026-09-05T12:00:00.000Z");

interface Call {
  readonly url: string;
  readonly apiKey: string | null;
}

/**
 * A `fetch` that answers from the captured files.
 *
 * A queue where the last entry repeats, so a test that walks two pages says so
 * by listing two answers and a test that does not care says one.
 */
function scrapeCreators(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: Call[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), apiKey: headers.get("x-api-key") });

    if (queue.length === 0) throw new Error(`the test planned no answer for ${String(input)}`);
    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;

    return Promise.resolve(
      new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
        status: reply.httpStatus,
      }),
    );
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "scrapecreators-test" }),
  };
}

const credentials = { apiKey: "a-scrapecreators-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["end to end tests keep breaking"], channels: [] },
    credentials,
    ...overrides,
  };
}

/** The cursor grammar, written out here so a test reads as the caller sees it. */
function cursorAt(phase: "keyword" | "subreddit", index: number, pages: number, after = "") {
  return `${phase}|${index}|${pages}|${after}`;
}

describe("the connector's declared economics", () => {
  it("is Reddit fetched by ScrapeCreators", () => {
    expect(scrapeCreatorsReddit.platform.id).toBe(redditPlatformId);
    expect(scrapeCreatorsReddit.provider.id).toBe(scrapeCreatorsProviderId);
  });

  it("bills a request, not a record, and prices it from the published pack", () => {
    // ScrapeCreators charges one credit per request whatever it returns. The
    // capture bought 7 posts with one credit and 23 with another, so a unit
    // read from either post count would be wrong about the other.
    expect(scrapeCreatorsReddit.billableUnit).toBe("request");
    // $47 for 25,000 credits, read from scrapecreators.com on 2026-09-05.
    expect(scrapeCreatorsReddit.pricePerUnitMicros).toBe(1880);
  });

  it("stores its posts under the platform the schema knows", () => {
    expect(() => assertSourcesCanBeStored([scrapeCreatorsReddit.platform.id])).not.toThrow();
  });
});

describe("reading a captured record", () => {
  const records = bodyOf(subredditPage).posts as Record<string, unknown>[];

  it("keeps only the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(records[0]);

    expect(post).toEqual({
      externalId: firstSubredditPostId,
      url: "https://www.reddit.com/r/softwaretesting/comments/1w71bul/starting_automation_from_0_as_a_qa_lead_how_are/",
      author: "redditor-1",
      channel: "softwaretesting",
      title:
        "Starting Automation from 0% as a QA Lead — How are you using AI, MCPs & Agents in QA?",
      text: expect.any(String) as unknown as string,
      postedAt: new Date("2026-09-04T11:08:36.000Z"),
    });
  });

  it("identifies a post by Reddit's own fullname, which is what deduplication is keyed on", () => {
    for (const record of records) {
      expect(toCandidatePost(record)?.externalId).toMatch(/^t3_[a-z0-9]+$/);
    }
  });

  it("drops a record with no id and one with no timestamp, rather than repairing it", () => {
    const [real] = records;
    const { name, id, ...noId } = real as Record<string, unknown>;
    const { created_at_iso, created_utc, ...noTime } = real as Record<string, unknown>;

    expect(toCandidatePost(noId)).toBeUndefined();
    expect(toCandidatePost(noTime)).toBeUndefined();
    expect(toCandidatePost(null)).toBeUndefined();
    expect(toCandidatePost("not a record")).toBeUndefined();
  });

  it("falls back to the title when a link post has no body", () => {
    const [real] = records;
    const post = toCandidatePost({ ...real, selftext: "" });

    expect(post?.text).toBe(post?.title);
  });
});

describe("the same post through either provider", () => {
  /**
   * The deduplication claim, at the parser.
   *
   * `posts` is keyed by `(source, external_id)` and the provider is outside
   * that key, so one post collected twice is one row — provided both
   * connectors compute the same id for it. They do, and both fixtures are real
   * payloads: Bright Data reports the fullname as `post_id` and ScrapeCreators
   * as `name`, and both are `t3_…`.
   */
  it("computes the same kind of id from each provider's own payload", () => {
    const brightDataRecords = JSON.parse(
      readFileSync(
        new URL("../brightdata/fixtures/posts-discover-by-subreddit-records.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>[];

    const fromBrightData = toBrightDataPost(brightDataRecords[0])?.externalId;
    const fromScrapeCreators = toCandidatePost(
      (bodyOf(subredditPage).posts as Record<string, unknown>[])[0],
    )?.externalId;

    expect(fromBrightData).toMatch(/^t3_[a-z0-9]+$/);
    expect(fromScrapeCreators).toMatch(/^t3_[a-z0-9]+$/);

    // The two captures collected different subreddits, so the ids differ. What
    // is asserted is that each provider's id is the one Reddit gave the post,
    // which is what makes them collide when the post really is the same.
    const brightDataFullname = brightDataRecords[0]?.post_id;
    const scrapeCreatorsFullname = (bodyOf(subredditPage).posts as Record<string, unknown>[])[0]
      ?.name;

    expect(fromBrightData).toBe(brightDataFullname);
    expect(fromScrapeCreators).toBe(scrapeCreatorsFullname);
  });
});

describe("searching", () => {
  it("returns the posts and reports what the provider says it charged", async () => {
    const stub = scrapeCreators([searchPage1]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(7);
    expect(result.posts[0]?.externalId).toBe(firstSearchPostId);

    // One credit for seven posts. `unitsConsumed` is the provider's own
    // `credits_charged` and never the length of the page.
    expect(result.unitsConsumed).toBe(1);
    expect(result.unitsConsumed).not.toBe(result.posts.length);
  });

  it("sends the key in the header the provider wants, and asks for the newest first", async () => {
    const stub = scrapeCreators([searchPage1]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await source.search(request());

    expect(stub.calls[0]?.apiKey).toBe(credentials.apiKey);
    expect(stub.calls[0]?.url).toContain("/v1/reddit/search");
    expect(stub.calls[0]?.url).toContain("sort=new");

    // No timeframe. The provider refuses one beside `sort=new`, which
    // `timeframe-rejected.json` is the captured proof of.
    expect(stub.calls[0]?.url).not.toContain("timeframe");
  });

  it("hands back the provider's cursor and follows it on the next call", async () => {
    const stub = scrapeCreators([searchPage1, searchPage2]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    expect(first.next).toEqual({
      status: "ready",
      cursor: cursorAt("keyword", 0, 1, searchCursor),
    });

    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    expect(stub.calls[1]?.url).toContain(`after=${encodeURIComponent(searchCursor)}`);
    // The second page is different posts, so following the cursor is what
    // stops the connector buying page one twice.
    expect(second.posts.map((post) => post.externalId)).not.toContain(firstSearchPostId);
    expect(second.unitsConsumed).toBe(1);
  });

  it("stops one input after its share of the poll, rather than paging until the cap does", async () => {
    const stub = scrapeCreators([searchPage1, searchPage2]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    // Page two reported a cursor of its own, and the connector still stopped:
    // two pages is `maxUnitsPerQueryPoll`, and the next poll starts the input
    // again rather than paging deeper into an old history.
    expect(bodyOf(searchPage2).after).toBeTruthy();
    expect(second.next).toEqual({ status: "done" });
    expect(scrapeCreatorsReddit.maxUnitsPerQueryPoll).toBe(2);
  });

  it("moves to the next keyword when the provider reports no more pages", async () => {
    const exhausted: Captured = {
      httpStatus: 200,
      body: { ...bodyOf(searchPage1), after: null },
    };
    const stub = scrapeCreators([exhausted]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["first", "second"], channels: [] } }),
    );

    expect(result.next).toEqual({ status: "ready", cursor: cursorAt("keyword", 1, 0) });
  });

  it("collects the subreddits after the keywords, and asks for a bare name", async () => {
    const exhausted: Captured = {
      httpStatus: 200,
      body: { ...bodyOf(searchPage1), after: null },
    };
    const stub = scrapeCreators([exhausted, subredditPage]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const query = { queries: ["a keyword"], channels: ["r/softwaretesting"] };
    const first = await source.search(request({ query }));

    expect(first.next).toEqual({ status: "ready", cursor: cursorAt("subreddit", 0, 0) });

    const second = await source.search(
      request({ query, cursor: (first.next as { cursor: string }).cursor }),
    );

    expect(stub.calls[1]?.url).toContain("/v1/reddit/subreddit");
    expect(stub.calls[1]?.url).toContain("subreddit=softwaretesting");
    expect(second.posts[0]?.externalId).toBe(firstSubredditPostId);
  });

  it("starts at the subreddits when a monitor names no keywords", async () => {
    const stub = scrapeCreators([subredditPage]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await source.search(request({ query: { queries: [], channels: ["softwaretesting"] } }));

    // One call, and it is the subreddit endpoint. An empty phase costs nothing
    // because skipping it makes no request.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toContain("/v1/reddit/subreddit");
  });

  it("finishes without a call when the monitor names nothing", async () => {
    const source = new ScrapeCreatorsRedditSource(runtimeWith(unreachableFetch));

    const result = await source.search(request({ query: { queries: [], channels: [] } }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
  });

  it("drops posts older than the caller asked for, and stops paying for older pages", async () => {
    const stub = scrapeCreators([subredditPage]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    // Every captured post is older than this, and the list is newest first, so
    // the next page could only be older still.
    const since = new Date("2026-09-05T00:00:00.000Z");
    const result = await source.search(
      request({ query: { queries: [], channels: ["softwaretesting"], since } }),
    );

    expect(result.posts).toEqual([]);
    // Still one credit: the request was made and billed before we could know.
    expect(result.unitsConsumed).toBe(1);
    // And no second page is asked for, because it would buy older posts.
    expect(result.next).toEqual({ status: "done" });
  });

  it("keeps the posts newer than `since` and pages on", async () => {
    const stub = scrapeCreators([subredditPage]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const since = new Date("2026-09-01T00:00:00.000Z");
    const result = await source.search(
      request({ query: { queries: [], channels: ["softwaretesting"], since } }),
    );

    expect(result.posts.length).toBeGreaterThan(0);
    for (const post of result.posts)
      expect(post.postedAt.getTime()).toBeGreaterThan(since.getTime());
    expect(result.next).toEqual({
      status: "ready",
      cursor: cursorAt("subreddit", 0, 1, subredditCursor),
    });
  });

  it("returns no more than the caller asked for", async () => {
    const stub = scrapeCreators([subredditPage]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: [], channels: ["softwaretesting"] }, limit: 3 }),
    );

    expect(result.posts).toHaveLength(3);
    // Trimming wastes nothing: the credit paid for the request, not the posts.
    expect(result.unitsConsumed).toBe(1);
  });

  it("bills for a subreddit that does not exist, and says it found nothing", async () => {
    // The provider answers 200 with an empty list and charges for it. A
    // misspelled subreddit in a monitor therefore costs a credit every poll
    // and returns nothing, and nothing in the answer says the name was wrong.
    const stub = scrapeCreators([unknownSubreddit]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: [], channels: ["this-subreddit-does-not-exist-intentwatch"] } }),
    );

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(1);
    expect(result.next).toEqual({ status: "done" });
  });

  it("refuses a cursor it did not issue", async () => {
    const source = new ScrapeCreatorsRedditSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-a-cursor" }))).rejects.toThrow(
      'cursor "not-a-cursor" was not issued by this source',
    );
  });

  it("repeats the provider's own sentence when the query is refused", async () => {
    const stub = scrapeCreators([timeframeRejected]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await expect(source.search(request())).rejects.toThrow(
      "You need to sort by 'top' to provide a timeframe",
    );
  });
});

describe("checking a key", () => {
  it("accepts the key the provider let past authentication", async () => {
    const stub = scrapeCreators([credentialsAccepted]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await expect(source.validateCredentials(credentials)).resolves.toEqual({ valid: true });
  });

  it("spends nothing to find out, and the captured answer proves it", async () => {
    const stub = scrapeCreators([credentialsAccepted]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await source.validateCredentials(credentials);

    // One call, with no query, so the provider refuses on the parameter after
    // it has accepted the key.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toContain("/v1/reddit/search");
    expect(stub.calls[0]?.url).not.toContain("query=");
    // The provider's own accounting, from the live capture.
    expect(bodyOf(credentialsAccepted).credits_charged).toBe(0);
  });

  it("refuses a wrong key with the provider's own words, and says where to fix it", async () => {
    const stub = scrapeCreators([credentialsRejected]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
    expect(check).toMatchObject({ reason: expect.stringContaining("Invalid API key") });
    expect((check as { reason: string }).reason).toContain("SCRAPECREATORS_API_KEY");
  });

  it("asks for a key before it asks the provider", async () => {
    const source = new ScrapeCreatorsRedditSource(runtimeWith(unreachableFetch));

    await expect(source.validateCredentials({})).resolves.toEqual({
      valid: false,
      reason: "Enter your ScrapeCreators API key.",
    });
  });

  it("throws when the provider cannot be reached, rather than blaming the key", async () => {
    // A refusal and an outage lead to different actions, so they must not
    // arrive as the same answer. docs/secrets.md, *Testing before storing*.
    const source = new ScrapeCreatorsRedditSource(runtimeWith(unreachableFetch));

    await expect(source.validateCredentials(credentials)).rejects.toThrow(/No test reaches/);
  });

  it("treats a 500 as the provider's problem and not the key's", async () => {
    const stub = scrapeCreators([{ httpStatus: 500, body: "upstream exploded" }]);
    const source = new ScrapeCreatorsRedditSource(runtimeWith(stub.fetch));

    await expect(source.validateCredentials(credentials)).rejects.toThrow(
      "ScrapeCreators answered 500",
    );
  });
});

describe("in the registry", () => {
  it("needs a recorded choice now that Reddit has two providers", () => {
    const registry = createSourceRegistry({
      definitions: [scrapeCreatorsReddit],
      runtime: runtimeWith(unreachableFetch),
    });

    expect(registry.get(redditPlatformId, scrapeCreatorsProviderId).provider.displayName).toBe(
      "ScrapeCreators",
    );
  });
});
