/**
 * The SocialCrawl X connector, driven against payloads captured from a live
 * account by `fixtures/capture.mjs` on 2026-09-05.
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
import { xPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { socialCrawlProviderId } from "./provider.js";
import { SocialCrawlXSource, socialCrawlX, toCandidatePost } from "./x.js";

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
const searchPage2 = fixture("search-page-2");
const noResults = fixture("search-no-results");
const fromHandle = fixture("search-from-handle");
const credentialsAccepted = fixture("credentials-accepted");
const credentialsRejected = fixture("credentials-rejected");
const sortRejected = fixture("sort-rejected");

function bodyOf(captured: Captured): Record<string, unknown> {
  return captured.body as Record<string, unknown>;
}

function dataOf(captured: Captured): Record<string, unknown> {
  return bodyOf(captured).data as Record<string, unknown>;
}

function itemsOf(captured: Captured): Record<string, unknown>[] {
  return dataOf(captured).items as Record<string, unknown>[];
}

/** Read out of `search-posts.json` by eye. */
const searchCursor = dataOf(searchPage1).next_cursor as string;
const firstPostId = "2096183117035827705";
const firstPostUrl = "https://x.com/x-user-1/status/2096183117035827705";

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
function socialCrawl(replies: readonly Captured[]) {
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
    logger: createLogger({ level: "silent", name: "socialcrawl-test" }),
  };
}

const credentials = { apiKey: "sc_a-socialcrawl-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["end to end tests keep breaking"], channels: [] },
    credentials,
    ...overrides,
  };
}

/** The cursor grammar, written out here so a test reads as the caller sees it. */
function cursorAt(phase: "keyword" | "handle", index: number, pages: number, after = "") {
  return `${phase}|${index}|${pages}|${after}`;
}

/** What the connector asked for, as a parsed query string. */
function paramsOf(call: Call | undefined): URLSearchParams {
  return new URL(call?.url ?? "https://example.invalid").searchParams;
}

describe("the connector's declared economics", () => {
  it("is X fetched by SocialCrawl", () => {
    expect(socialCrawlX.platform.id).toBe(xPlatformId);
    expect(socialCrawlX.provider.id).toBe(socialCrawlProviderId);
  });

  it("bills a request, not a post, and prices it from the published pack", () => {
    // One credit bought twenty posts on a full page and zero on an empty one
    // in the same capture run, so a unit read from either post count would be
    // wrong about the other.
    expect(socialCrawlX.billableUnit).toBe("request");
    // £15 for 2,500 credits, read from socialcrawl.dev/pricing on 2026-09-05,
    // at GBP 1 = USD 1.353 for 2026-09-04.
    expect(socialCrawlX.pricePerUnitMicros).toBe(8118);
  });

  it("stores its posts under the platform the schema knows", () => {
    expect(() => assertSourcesCanBeStored([socialCrawlX.platform.id])).not.toThrow();
  });
});

describe("reading a captured record", () => {
  const records = itemsOf(searchPage1);

  it("keeps only the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(records[0]);

    expect(post).toEqual({
      externalId: firstPostId,
      url: firstPostUrl,
      author: "x-user-1",
      text: expect.any(String) as unknown as string,
      postedAt: new Date("2026-09-05T10:26:14.000Z"),
    });
  });

  it("gives a post no channel, because on X the author is the context", () => {
    expect(toCandidatePost(records[0])).not.toHaveProperty("channel");
    expect(toCandidatePost(records[0])).not.toHaveProperty("title");
  });

  it("identifies a post by X's own id, which is what deduplication is keyed on", () => {
    for (const record of records) {
      expect(toCandidatePost(record)?.externalId).toMatch(/^[0-9]+$/);
    }
  });

  it("drops a record with no id and one with no timestamp, rather than repairing it", () => {
    const real = records[0] as { post: Record<string, unknown> };

    const { id, ...noId } = real.post;
    const { published_at, ...noTime } = real.post;
    const { url, ...noUrl } = real.post;

    expect(toCandidatePost({ post: noId })).toBeUndefined();
    expect(toCandidatePost({ post: noTime })).toBeUndefined();
    expect(toCandidatePost({ post: noUrl })).toBeUndefined();
    expect(toCandidatePost({ post: { ...real.post, published_at: "not a date" } })).toBeUndefined();
    expect(toCandidatePost(null)).toBeUndefined();
    expect(toCandidatePost("not a record")).toBeUndefined();
    expect(toCandidatePost({})).toBeUndefined();
  });

  it("drops a post the provider has already flagged as deleted", () => {
    const real = records[0] as { post: Record<string, unknown> };

    // Every captured record carried `deleted: false`, so this asserts our half
    // of a flag the provider has not yet set on a live post. Storing one it
    // marked would be showing removed content from the first minute.
    expect(toCandidatePost({ post: { ...real.post, flags: { deleted: false } } })).toBeDefined();
    expect(toCandidatePost({ post: { ...real.post, flags: { deleted: true } } })).toBeUndefined();
  });

  it("gives the classifier an empty string when a post is media with no words", () => {
    const real = records[0] as { post: Record<string, unknown> };

    expect(toCandidatePost({ post: { ...real.post, content: { text: "" } } })?.text).toBe("");
    expect(toCandidatePost({ post: { ...real.post, content: null } })?.text).toBe("");
  });
});

describe("searching", () => {
  it("returns the posts and reports what the provider says it charged", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(20);
    expect(result.posts[0]?.externalId).toBe(firstPostId);

    // One credit for twenty posts. `unitsConsumed` is the provider's own
    // `credits_used` and never the length of the page.
    expect(result.unitsConsumed).toBe(1);
    expect(result.unitsConsumed).not.toBe(result.posts.length);
  });

  it("sends the key in the header the provider wants, and asks for the newest first", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await source.search(request());

    expect(stub.calls[0]?.apiKey).toBe(credentials.apiKey);
    expect(stub.calls[0]?.url).toContain("/v1/twitter/search/tweets");

    // `latest` and `top` are the only values the provider accepts, and it said
    // so itself in sort-rejected.json. `top` ranks by engagement, which
    // returned three-week-old posts about anime for a query about tests.
    expect(paramsOf(stub.calls[0]).get("sort")).toBe("latest");
    expect(bodyOf(sortRejected).error).toMatchObject({
      message: expect.stringContaining("Allowed values: latest, top") as unknown as string,
    });
  });

  it("passes a monitor's words through unquoted, because quoting matched nothing", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await source.search(request());

    expect(paramsOf(stub.calls[0]).get("query")).toBe("end to end tests keep breaking");
  });

  it("asks the provider for the window with an operator, since there is no date parameter", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date("2026-09-03T18:30:00.000Z"),
        },
      }),
    );

    // Floored to the day: the operator takes a date, and asking from midnight
    // returns posts we already hold, which cost nothing extra and deduplicate.
    expect(paramsOf(stub.calls[0]).get("query")).toBe("flaky tests since:2026-09-03");
  });

  it("cuts to the exact time as well, because the operator only narrows to a day", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const since = new Date("2026-09-05T00:00:00.000Z");
    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since } }),
    );

    const collected = itemsOf(searchPage1).length;

    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThan(collected);
    for (const post of result.posts)
      expect(post.postedAt.getTime()).toBeGreaterThan(since.getTime());
  });

  it("hands back the provider's cursor and follows it on the next call", async () => {
    const stub = socialCrawl([searchPage1, searchPage2]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    expect(first.next).toEqual({
      status: "ready",
      cursor: cursorAt("keyword", 0, 1, searchCursor),
    });

    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    expect(paramsOf(stub.calls[1]).get("cursor")).toBe(searchCursor);
    // The second page is different posts, so following the cursor is what
    // stops the connector buying page one twice.
    expect(second.posts.map((post) => post.externalId)).not.toContain(firstPostId);
    expect(second.unitsConsumed).toBe(1);
  });

  it("finishes an input when the provider reports no cursor, and a short page is not the signal", async () => {
    const stub = socialCrawl([searchPage2]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    // Seventeen posts, not twenty, and that is not how the connector knows.
    // The last page simply carries no `next_cursor`.
    expect(result.posts).toHaveLength(17);
    expect(dataOf(searchPage2).next_cursor).toBeUndefined();
    expect(result.next).toEqual({ status: "done" });
  });

  it("stops one input after its share of the poll, rather than paging until the cap does", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    // Both pages reported a cursor, and the connector still stopped: two pages
    // is `maxUnitsPerQueryPoll`, and the next poll starts the input again
    // rather than paging deeper into an old history.
    expect(dataOf(searchPage1).next_cursor).toBeTruthy();
    expect(second.next).toEqual({ status: "done" });
    expect(socialCrawlX.maxUnitsPerQueryPoll).toBe(2);
  });

  it("stops paging when the whole page is older than the monitor asked for", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date("2026-09-06T00:00:00.000Z"),
        },
      }),
    );

    // The page carried a cursor, and buying the next one would buy posts that
    // are older still. The list is newest first, which is what makes that safe.
    expect(result.posts).toHaveLength(0);
    expect(result.next).toEqual({ status: "done" });
  });

  it("moves to the next query when one is finished", async () => {
    const stub = socialCrawl([searchPage2]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["first", "second"], channels: [] } }),
    );

    expect(result.next).toEqual({ status: "ready", cursor: cursorAt("keyword", 1, 0) });
  });

  it("collects the handles after the queries, through X's own from: operator", async () => {
    const stub = socialCrawl([searchPage2, fromHandle]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const query = { queries: ["flaky tests"], channels: ["@github"] };

    const first = await source.search(request({ query }));
    expect(first.next).toEqual({ status: "ready", cursor: cursorAt("handle", 0, 0) });

    await source.search(request({ query, cursor: cursorAt("handle", 0, 0) }));

    // The at-sign is a person's way of writing a handle and not the operator's.
    expect(paramsOf(stub.calls[1]).get("query")).toBe("from:github");
  });

  it("skips a phase the monitor left empty, without making a request for it", async () => {
    const stub = socialCrawl([fromHandle]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await source.search(request({ query: { queries: [], channels: ["github"] } }));

    expect(stub.calls).toHaveLength(1);
    expect(paramsOf(stub.calls[0]).get("query")).toBe("from:github");
  });

  it("asks for nothing at all when the monitor named neither", async () => {
    const source = new SocialCrawlXSource(runtimeWith(unreachableFetch));

    const result = await source.search(request({ query: { queries: [], channels: [] } }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
  });

  it("treats a page that found nothing as free, and does not read it as the end of the query", async () => {
    const stub = socialCrawl([noResults]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["first", "second"], channels: [] } }),
    );

    // Measured twice: the provider refunds a search that matches nothing. The
    // same query answered empty once and with twenty posts nineteen minutes
    // later, so the next poll asks again — this only ends the input.
    expect(result.unitsConsumed).toBe(0);
    expect(result.posts).toHaveLength(0);
    expect(result.next).toEqual({ status: "ready", cursor: cursorAt("keyword", 1, 0) });
  });

  it("returns no more than the caller asked for, which costs nothing here", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(request({ limit: 3 }));

    // The credit was spent on the request, not on the posts, so trimming
    // wastes no money. On a provider that bills per record it would waste all
    // of it.
    expect(result.posts).toHaveLength(3);
    expect(result.unitsConsumed).toBe(1);
  });

  it("refuses a cursor it did not issue, rather than reporting the query finished", async () => {
    const source = new SocialCrawlXSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-a-cursor" }))).rejects.toThrow(
      /was not issued by this source/,
    );
    await expect(source.search(request({ cursor: "keyword|-1|0|" }))).rejects.toThrow();
    await expect(source.search(request({ cursor: "elsewhere|0|0|" }))).rejects.toThrow();
  });

  it("hands a rate limit up with the place it had reached, so the wait costs no page", async () => {
    const limited: Captured = {
      httpStatus: 429,
      body: { success: false, error: { message: "Rate limit exceeded" } },
    };
    const stub = socialCrawl([limited]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const result = await source.search(request({ cursor: cursorAt("keyword", 0, 1, "abc") }));

    // Never measured against the real provider: no capture run has been rate
    // limited. This is our half of that contract.
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({
      status: "wait",
      retryAfter: new Date(now.getTime() + 60_000),
      cursor: cursorAt("keyword", 0, 1, "abc"),
    });
  });

  it("repeats the provider's own sentence when it refuses the query", async () => {
    const stub = socialCrawl([sortRejected]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await expect(source.search(request())).rejects.toThrow(/Allowed values: latest, top/);
  });
});

describe("checking a key", () => {
  it("accepts a key the provider let past authentication", async () => {
    // The probe sends no query, so the provider refuses on the parameter after
    // it has accepted the key. Both captured answers charged nothing.
    const stub = socialCrawl([credentialsAccepted]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    await expect(source.validateCredentials(credentials)).resolves.toEqual({ valid: true });

    expect(paramsOf(stub.calls[0]).get("query")).toBeNull();
    expect(bodyOf(credentialsAccepted).credits_used).toBe(0);
    expect(bodyOf(credentialsAccepted).credits_remaining).toBe(100);
  });

  it("refuses a key with the provider's own words, and bills nothing to find out", async () => {
    const stub = socialCrawl([credentialsRejected]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials({ apiKey: "wrong" });

    expect(check).toEqual({
      valid: false,
      reason: expect.stringContaining("Keys start with 'sc_'") as unknown as string,
    });
    expect(bodyOf(credentialsRejected).credits_used).toBe(0);
  });

  it("asks for a key before it asks the provider", async () => {
    const source = new SocialCrawlXSource(runtimeWith(unreachableFetch));

    await expect(source.validateCredentials({})).resolves.toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });

  it("separates a provider that is down from a key that is wrong", async () => {
    const down: Captured = { httpStatus: 502, body: "upstream unavailable" };
    const stub = socialCrawl([down]);
    const source = new SocialCrawlXSource(runtimeWith(stub.fetch));

    // An outage must not tell a person to replace a key that works.
    // docs/secrets.md, *Testing before storing*.
    await expect(source.validateCredentials(credentials)).rejects.toThrow(
      /SocialCrawl answered 502/,
    );
  });

  it("will not search without a key", async () => {
    const source = new SocialCrawlXSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ credentials: {} }))).rejects.toThrow(
      /No SocialCrawl API key/,
    );
  });
});
