/**
 * The SocialData X connector, driven against payloads captured from a live
 * account by `x-fixtures/capture.mjs` on 2026-09-07.
 *
 * Nothing here reaches the network. The runtime's `fetch` replays the captured
 * files, so a test that tried to collect anything would fail rather than spend
 * from the account balance. docs/testing.md, *No test spends money*.
 *
 * The literals below were read out of the fixtures by eye. Re-running the
 * capture collects different tweets and will change them; that is a deliberate
 * edit to make at the same time, not a reason to derive the expected values
 * from the code that produces them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { xPlatformId } from "../../platforms.js";
import { createSourceRegistry } from "../../registry.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SearchResult, SourceRuntime } from "../../types.js";
import { toCandidatePost as toSocialCrawlPost } from "../socialcrawl/x.js";
import { socialDataProviderId } from "./provider.js";
import { SocialDataXSource, socialDataX, toCandidatePost } from "./x.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./x-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const searchLatest = fixture("search-latest");
const searchSince = fixture("search-since");
const searchPage2 = fixture("search-page-2");
const noResults = fixture("search-no-results");
const credentialsRejected = fixture("credentials-rejected");

function bodyOf(captured: Captured): Record<string, unknown> {
  return captured.body as Record<string, unknown>;
}

function tweetsOf(captured: Captured): Record<string, unknown>[] {
  return bodyOf(captured).tweets as Record<string, unknown>[];
}

/** Read out of `search-latest.json` by eye. */
const firstTweetId = "2096868759189254157";
const firstTweetAt = new Date("2026-09-07T07:50:44.000Z");
const pageOneCursor = bodyOf(searchLatest).next_cursor as string;

/** After the whole captured page, so a `since` cut leaves nothing. */
const afterEverything = new Date("2026-09-08T00:00:00.000Z");

const now = new Date("2026-09-07T08:00:00.000Z");

interface Call {
  readonly url: string;
  readonly key: string | null;
}

/**
 * A `fetch` that answers from the captured files.
 *
 * A queue where the last entry repeats, so a test that walks two pages says so
 * by listing two answers and a test that does not care says one.
 */
function socialData(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: Call[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), key: headers.get("authorization") });

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
    logger: createLogger({ level: "silent", name: "socialdata-x-test" }),
  };
}

const credentials = { apiKey: "a-socialdata-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["flaky tests"], channels: [] },
    credentials,
    ...overrides,
  };
}

function sourceFor(replies: readonly Captured[]) {
  const provider = socialData(replies);
  return { source: new SocialDataXSource(runtimeWith(provider.fetch)), provider };
}

/** The cursor grammar, written out here so a test reads as the caller sees it. */
function cursorAt(index: number, pages: number, after = "") {
  return `${index}|${pages}|${after}`;
}

function paramsOf(call: Call | undefined): URLSearchParams {
  if (!call) throw new Error("the test expected a call the connector did not make");
  return new URL(call.url).searchParams;
}

function cursorOf(next: SearchResult["next"]): string {
  if (next.status === "done") throw new Error("expected a cursor, the walk was done");
  return next.cursor as string;
}

describe("the connector's declared economics", () => {
  it("is X fetched by SocialData", () => {
    expect(socialDataX.platform.id).toBe(xPlatformId);
    expect(socialDataX.provider.id).toBe(socialDataProviderId);
  });

  it("bills a tweet, because that is what the provider charges for", () => {
    // Twenty tweets moved the balance $0.0040 and seven moved it $0.0014. A
    // connector reporting "1 request" against a per-tweet price would let a
    // monitor spend twenty times its cap before anything refused it.
    expect(socialDataX.billableUnit).toBe("tweet");
    expect(socialDataX.pricePerUnitMicros).toBe(200);
    // The unit is the post, so the pricing page can compare it directly:
    // $0.0100 for fifty against SocialCrawl's $0.0203.
    expect(socialDataX.postsPerUnit).toBe(1);
  });

  it("stores its posts under the platform the schema knows", () => {
    expect(() => assertSourcesCanBeStored([socialDataX.platform.id])).not.toThrow();
  });

  it("registers beside the other provider for the same platform", () => {
    const registry = createSourceRegistry({
      definitions: [socialDataX],
      runtime: runtimeWith(socialData([]).fetch),
    });

    expect(registry.has(xPlatformId, socialDataProviderId)).toBe(true);
  });
});

describe("reading a captured record", () => {
  const tweets = tweetsOf(searchLatest);

  it("keeps only the fields a post row has, from the real payload", () => {
    const first = tweets[0];
    if (!first) throw new Error("the captured page held no tweets");

    const handle = (first.user as { screen_name: string }).screen_name;

    expect(toCandidatePost(first)).toEqual({
      externalId: firstTweetId,
      url: `https://x.com/${handle}/status/${firstTweetId}`,
      author: handle,
      text: expect.any(String) as unknown as string,
      postedAt: firstTweetAt,
    });
  });

  it("builds the post URL, because the provider returns none", () => {
    // US-060 opened one and it landed on the post. The format is also what
    // SocialCrawl returns for the same tweet, so the two connectors store one
    // address for one post.
    const post = toCandidatePost(tweets[0]);

    expect(post?.url).toMatch(/^https:\/\/x\.com\/[^/]+\/status\/\d+$/);
    expect(post?.url).toContain(firstTweetId);
    // Nothing in the payload carries a URL for us to have copied.
    expect(Object.keys(tweets[0] ?? {}).some((key) => key === "url")).toBe(false);
  });

  it("reads the full text rather than the truncated one", () => {
    // `text` is cut short on a long tweet and the classifier reads what the
    // person wrote.
    const post = toCandidatePost({ ...tweets[0], full_text: "the whole thing", text: "the who…" });

    expect(post?.text).toBe("the whole thing");
  });

  it("reads every record in the captured page", () => {
    expect(tweets).toHaveLength(20);
    expect(tweets.map((tweet) => toCandidatePost(tweet)).filter(Boolean)).toHaveLength(20);
  });

  it("drops a record with no handle, rather than linking to a URL that opens nothing", () => {
    // `x.com/undefined/status/123` is a link a person would click once.
    expect(toCandidatePost({ ...tweets[0], user: {} })).toBeUndefined();
    expect(toCandidatePost({ ...tweets[0], user: undefined })).toBeUndefined();
  });

  it("drops a record with no id or no timestamp", () => {
    expect(toCandidatePost({ ...tweets[0], id_str: undefined })).toBeUndefined();
    expect(toCandidatePost({ ...tweets[0], tweet_created_at: "not a date" })).toBeUndefined();
  });
});

describe("the identity two providers share", () => {
  it("reads the same tweet id as the SocialCrawl parser", () => {
    // `posts` is keyed by `(source, external_id)` with the provider outside
    // the key, so a post already collected through SocialCrawl must not be
    // stored and billed again here.
    const id = firstTweetId;

    // That provider wraps its record in `{ post: … }`, which is a difference
    // between the two wire formats and not between the ids inside them.
    const fromSocialCrawl = toSocialCrawlPost({
      post: {
        id,
        url: `https://x.com/somebody/status/${id}`,
        published_at: "2026-09-07T07:50:44.000Z",
        content: { text: "a post about flaky tests" },
      },
    });

    expect(toCandidatePost(tweetsOf(searchLatest)[0])?.externalId).toBe(
      fromSocialCrawl?.externalId,
    );
  });

  it("reads the ids of a whole captured page, all of them distinct", () => {
    const ids = tweetsOf(searchLatest)
      .map((tweet) => toCandidatePost(tweet)?.externalId)
      .filter((id): id is string => id !== undefined);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });
});

describe("searching", () => {
  it("asks for the newest first, with the key", async () => {
    const { source, provider } = sourceFor([searchLatest]);

    const result = await source.search(request());

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.key).toBe(`Bearer ${credentials.apiKey}`);
    expect(provider.calls[0]?.url).toContain("/twitter/search");
    expect(paramsOf(provider.calls[0]).get("query")).toBe("flaky tests");
    // Measured across a whole captured page, which is what the early-stop
    // rule below rests on.
    expect(paramsOf(provider.calls[0]).get("type")).toBe("Latest");
    expect(result.posts).toHaveLength(20);
  });

  it("counts the tweets the page returned, because that is the bill", async () => {
    const { source } = sourceFor([searchLatest]);

    const result = await source.search(request());

    expect(result.unitsConsumed).toBe(20);
  });

  it("hands back the provider's cursor, then walks to the next query", async () => {
    const { source, provider } = sourceFor([searchLatest, searchPage2]);

    const first = await source.search(request());
    expect(cursorOf(first.next)).toBe(cursorAt(0, 1, pageOneCursor));

    const second = await source.search(request({ cursor: cursorOf(first.next) }));
    expect(paramsOf(provider.calls[1]).get("cursor")).toBe(pageOneCursor);

    // Two pages is this query's whole budget and the monitor named one query.
    expect(second.next).toEqual({ status: "done" });
  });

  it("finishes when the cursor points past the queries a monitor still names", async () => {
    const { source, provider } = sourceFor([searchLatest]);

    const result = await source.search(request({ cursor: cursorAt(7, 0) }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses a cursor it did not issue", async () => {
    const { source } = sourceFor([searchLatest]);

    await expect(source.search(request({ cursor: "not-a-cursor" }))).rejects.toThrow(
      /was not issued by this source/,
    );
  });

  it("does nothing for a monitor that named only channels", async () => {
    const { source, provider } = sourceFor([searchLatest]);

    const result = await source.search(request({ query: { queries: [], channels: ["someone"] } }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
    expect(provider.calls).toHaveLength(0);
  });

  it("reports an empty answer as an empty page rather than failing", async () => {
    const { source } = sourceFor([noResults]);

    const result = await source.search(request({ query: { queries: ["nobody"], channels: [] } }));

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({ status: "done" });
  });
});

describe("the window, which goes to the provider", () => {
  /**
   * The thing this connector exists for. `socialcrawl/x.ts` has no window at
   * all: it buys everything older than `since` and discards it here. A
   * 24-hour window returned 7 tweets for $0.0014 where the unwindowed call
   * returned 20 for $0.0040.
   */
  it("folds `since` into the query as a UNIX second", async () => {
    const { source, provider } = sourceFor([searchSince]);
    const since = new Date("2026-09-06T08:00:00.000Z");

    await source.search(request({ query: { queries: ["flaky tests"], channels: [], since } }));

    expect(paramsOf(provider.calls[0]).get("query")).toBe(
      `flaky tests since_time:${since.getTime() / 1000}`,
    );
  });

  it("floors the instant rather than rounding it", async () => {
    // Rounding up would ask for posts after `since` and lose anything written
    // in the second between.
    const { source, provider } = sourceFor([searchSince]);
    const since = new Date("2026-09-06T08:00:00.900Z");

    await source.search(request({ query: { queries: ["flaky tests"], channels: [], since } }));

    expect(paramsOf(provider.calls[0]).get("query")).toContain(
      `since_time:${Math.floor(since.getTime() / 1000)}`,
    );
  });

  it("sends no window when the monitor has never looked", async () => {
    const { source, provider } = sourceFor([searchLatest]);

    await source.search(request());

    expect(paramsOf(provider.calls[0]).get("query")).toBe("flaky tests");
  });

  it("still makes the exact cut here, because a window sent is not a window honoured", async () => {
    // BUG-002 is what happens when a provider's window is trusted. This costs
    // nothing and is the difference between a window that quietly stops
    // working and one that does.
    const { source } = sourceFor([searchLatest]);
    const since = new Date("2026-09-07T00:00:00.000Z");

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since } }),
    );

    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThan(20);
    expect(result.posts.every((post) => post.postedAt > since)).toBe(true);
  });
});

describe("stopping early on a page that is entirely old", () => {
  /**
   * The rule three LinkedIn connectors had to do without, and it is legitimate
   * here because `type=Latest` was measured to order newest first. On a
   * provider that bills per tweet, a page bought and discarded is not a wasted
   * request — it is a wasted twenty.
   */
  it("stops paging when nothing on the page survives `since`", async () => {
    const { source } = sourceFor([searchLatest]);

    const result = await source.search(
      request({
        query: {
          queries: ["flaky tests", "brittle selectors"],
          channels: [],
          since: afterEverything,
        },
      }),
    );

    expect(result.posts).toEqual([]);
    // On to the next query rather than the next page of this one.
    expect(cursorOf(result.next)).toBe(cursorAt(1, 0));
  });

  it("the captured page really is newest first, which is what the rule rests on", () => {
    const dates = tweetsOf(searchLatest).map((tweet) => String(tweet.tweet_created_at));
    const sorted = [...dates].sort().reverse();

    expect(dates).toEqual(sorted);
  });
});

describe("checking a key", () => {
  it("reads the balance, which is free and needs no search", async () => {
    const { source, provider } = sourceFor([{ httpStatus: 200, body: { balance_usd: 0.0718 } }]);

    await expect(source.validateCredentials(credentials)).resolves.toEqual({ valid: true });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.url).toContain("/user/balance");
    expect(provider.calls[0]?.url).not.toContain("/search");
  });

  it("refuses a key the provider rejected", async () => {
    const { source } = sourceFor([credentialsRejected]);

    const check = await source.validateCredentials(credentials);

    expect(credentialsRejected.httpStatus).toBe(401);
    expect(check.valid).toBe(false);
  });

  it("tells an empty balance from a wrong key, because the repairs differ", async () => {
    // A person whose account is empty has a perfectly good key. Telling them
    // to replace it sends them to look at the one thing that is fine.
    const { source } = sourceFor([
      { httpStatus: 402, body: { status: "error", message: "Insufficient balance" } },
    ]);

    const check = await source.validateCredentials(credentials);

    expect(check).toEqual({
      valid: false,
      reason: expect.stringContaining("Top up") as unknown as string,
    });
  });

  it("throws rather than blaming the key when the provider is unreachable", async () => {
    const { source } = sourceFor([{ httpStatus: 503, body: "upstream is down" }]);

    await expect(source.validateCredentials(credentials)).rejects.toThrow(
      /SocialData answered 503/,
    );
  });

  it("asks for a key rather than calling the provider without one", async () => {
    const { source, provider } = sourceFor([]);

    const check = await source.validateCredentials({});

    expect(check).toEqual({ valid: false, reason: "Enter your SocialData API key." });
    expect(provider.calls).toHaveLength(0);
  });
});
