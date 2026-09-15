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
import type { ReplyRequest, SearchRequest, SearchResult, SourceRuntime } from "../../types.js";
import { toCandidatePost as toSocialCrawlPost } from "../socialcrawl/x.js";
import { socialDataProviderId } from "./provider.js";
import { SocialDataXSource, socialDataX, toCandidatePost, toCandidateReply } from "./x.js";

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
/** US-136: the conversation under a tweet claiming 150 replies, two pages. */
const repliesPage1 = fixture("comments-page-1");
const repliesPage2 = fixture("comments-page-2");
const ledger = JSON.parse(
  readFileSync(new URL("./x-fixtures/ledger.json", import.meta.url), "utf8"),
) as { calls: { call: string; spentUsd: number | null }[] };

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

/** The tweet the reply capture asked about: the root row on its own page. */
const threadId = "2064374643729773029";

function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
  return {
    postUrl: `https://x.com/x-user-2/status/${threadId}`,
    postExternalId: threadId,
    credentials,
    ...overrides,
  };
}

describe("replies", () => {
  it("promises them, at the tweet price, and the ledger agrees", () => {
    expect(socialDataX.canFetchReplies).toBe(true);
    expect(socialDataX.replyPricePerUnitMicros).toBeUndefined();

    // Eleven rows, $0.0022: 200 micro-dollars a row, the search price.
    const first = ledger.calls.find((entry) => entry.call === "comments-page-1");
    expect(first?.spentUsd).toBe(0.0022);
    expect(tweetsOf(repliesPage1)).toHaveLength(11);
  });

  it("asks by tweet id, and by cursor on the next page", async () => {
    const { source, provider } = sourceFor([repliesPage1, repliesPage2]);

    const first = await source.fetchReplies(replyRequest());
    const second = await source.fetchReplies(
      replyRequest({ cursor: cursorOf(first.next), positionOffset: 11 }),
    );

    expect(new URL(provider.calls[0]?.url ?? "").pathname).toBe(
      `/twitter/tweets/${threadId}/comments`,
    );
    expect(paramsOf(provider.calls[0]).get("cursor")).toBeNull();
    expect(paramsOf(provider.calls[1]).get("cursor")).toBe(
      (bodyOf(repliesPage1) as { next_cursor: string }).next_cursor,
    );
    expect(second.itemsReturned).toBe(1);
  });

  /**
   * The provider puts the root tweet on the page as its last row and bills it
   * with the rest. It is dropped and it is paid for, and both halves matter:
   * storing it would make the post its own reply, and not counting it would
   * under-report the bill by a row a page.
   */
  it("drops the root tweet from the page and still counts it in the bill", async () => {
    const rows = tweetsOf(repliesPage1);
    expect(rows.at(-1)?.id_str).toBe(threadId);

    const { source } = sourceFor([repliesPage1]);
    const result = await source.fetchReplies(replyRequest());

    expect(result.itemsReturned).toBe(11);
    expect(result.unitsConsumed).toBe(11);
    // BUG-020: the usage row multiplies units by the reply price, so the
    // product is what a page is recorded at, and it must be what it cost.
    expect(
      result.unitsConsumed *
        (socialDataX.replyPricePerUnitMicros ?? socialDataX.pricePerUnitMicros),
    ).toBe(11 * 200);
    expect(result.replies).toHaveLength(10);
    expect(result.replies.some((reply) => reply.externalId === threadId)).toBe(false);
  });

  it("hangs a nested reply under its parent reply and a top-level one under the post", async () => {
    const { source } = sourceFor([repliesPage1]);
    const { replies } = await source.fetchReplies(replyRequest());

    for (const reply of replies) expect(reply.parentPostExternalId).toBe(threadId);

    const nested = replies.filter((reply) => reply.parentReplyExternalId !== undefined);
    const topLevel = replies.filter((reply) => reply.parentReplyExternalId === undefined);
    // Six of the ten hang under other replies, read off the fixture by eye.
    expect(nested).toHaveLength(6);
    expect(topLevel).toHaveLength(4);
    for (const reply of nested) expect(reply.parentReplyExternalId).not.toBe(threadId);
  });

  it("builds the same URL shape a post gets, from the handle and the id", async () => {
    const { source } = sourceFor([repliesPage1]);
    const { replies } = await source.fetchReplies(replyRequest());

    for (const reply of replies) {
      expect(reply.url).toBe(`https://x.com/${reply.author}/status/${reply.externalId}`);
    }
  });

  it("drops a row from another conversation", () => {
    const row = tweetsOf(repliesPage1)[0] as Record<string, unknown>;

    expect(
      toCandidateReply(
        { ...row, conversation_id_str: "1" },
        { parentPostExternalId: threadId, position: 0 },
      ),
    ).toBeUndefined();
  });

  it("keeps the provider's own position, root row and all", async () => {
    const { source } = sourceFor([repliesPage1]);
    const { replies } = await source.fetchReplies(replyRequest({ positionOffset: 30 }));

    expect(replies[0]?.threadPosition).toBe(30);
  });

  /**
   * The page is newest first, measured across all eleven rows. So a page on
   * which every reply is older than `since` ends the walk: the next one would
   * be bought, at a row each, to be thrown away.
   */
  it("is newest first, and ends the walk when a page is entirely older than since", async () => {
    const dates = tweetsOf(repliesPage1).map((row) => Date.parse(String(row.tweet_created_at)));
    expect(dates.every((value, index) => index === 0 || (dates[index - 1] ?? 0) >= value)).toBe(
      true,
    );

    const { source } = sourceFor([repliesPage1]);
    const all = await source.fetchReplies(replyRequest());
    const newest = all.replies.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));

    const later = await source.fetchReplies(replyRequest({ since: newest.postedAt }));

    expect(later.replies).toHaveLength(0);
    expect(later.itemsReturned).toBe(11);
    expect(later.unitsConsumed).toBe(11);
    expect(later.next.status).toBe("done");
  });

  /**
   * Page two of the captured thread is the root tweet alone, billed, with a
   * cursor still offered. Following it buys the same row again, so a page
   * that yields nothing new is the end of the walk — and the thread stays
   * partial, because the cursor is the only evidence of more there is.
   */
  it("ends the walk on a page that yields nothing new, and calls the thread partial", async () => {
    expect(tweetsOf(repliesPage2)).toHaveLength(1);
    expect((bodyOf(repliesPage2) as { next_cursor?: string }).next_cursor).toBeTruthy();

    const { source } = sourceFor([repliesPage2]);
    const result = await source.fetchReplies(replyRequest({ positionOffset: 11 }));

    expect(result.replies).toHaveLength(0);
    expect(result.unitsConsumed).toBe(1);
    expect(result.next.status).toBe("done");
    expect(result.partial).toBe(true);
  });

  it("calls a page with no cursor the end, and partial only while a cursor remains", async () => {
    const { source } = sourceFor([
      { httpStatus: 200, body: { tweets: tweetsOf(repliesPage1), next_cursor: null } },
    ]);
    const result = await source.fetchReplies(replyRequest());

    expect(result.next.status).toBe("done");
    expect(result.partial).toBe(false);
  });

  /**
   * A 402 mid-thread is thrown, once, with the provider's repair in the
   * message. It ends the replies step the way it ends a search, and the
   * thread is re-opened next poll because its row was never marked.
   */
  it("throws on an empty balance rather than retrying or reading it as an empty page", async () => {
    const { source, provider } = sourceFor([
      { httpStatus: 402, body: { status: "error", message: "Insufficient balance" } },
    ]);

    await expect(source.fetchReplies(replyRequest())).rejects.toMatchObject({
      name: "SocialDataError",
      kind: "balance",
      message: expect.stringContaining("Top up") as unknown as string,
    });
    expect(provider.calls).toHaveLength(1);
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
