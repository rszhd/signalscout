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
import { toCandidateReply } from "./comments.js";
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

const repliesPage1 = fixture("replies-page-1");
const repliesPage2 = fixture("replies-page-2");

/**
 * Replies, driven against the thread captured on 2026-09-06.
 *
 * The post claimed 71 replies and the first page returned 28 of them. That gap
 * is the provider's business; what this file asserts is that the connector
 * reports what arrived rather than what was promised.
 */
describe("reading the replies under a post", () => {
  const replyRequest = {
    postUrl: "https://x.com/x-user-1/status/2066207953355432118",
    postExternalId: "2066207953355432118",
    credentials,
  };

  it("declares that it can, on the connector the registry builds", () => {
    const built = new SocialCrawlXSource(runtimeWith(unreachableFetch));

    expect(socialCrawlX.canFetchReplies).toBe(true);
    expect(built.canFetchReplies).toBe(true);
    expect(built.replyPricePerUnitMicros).toBe(8118);
    expect(typeof built.fetchReplies).toBe("function");
  });

  it("asks the replies endpoint for that post", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([repliesPage1]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    await source.fetchReplies(replyRequest);

    expect(calls[0]?.url).toContain("/v1/twitter/tweet/replies");
    expect(calls[0]?.url).toContain(encodeURIComponent(replyRequest.postUrl));
  });

  it("returns the page it was given, linked to the post above", async () => {
    const { fetch: fetchStub } = socialCrawl([repliesPage1]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.length).toBeGreaterThan(20);
    expect(
      result.replies.every((reply) => reply.parentPostExternalId === replyRequest.postExternalId),
    ).toBe(true);
    expect(result.unitsConsumed).toBe(1);
  });

  it("keeps the provider's own link, because X gives one", async () => {
    const { fetch: fetchStub } = socialCrawl([repliesPage1]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    const [reply] = (await source.fetchReplies(replyRequest)).replies;

    // Not a built link. YouTube needs one built; X does not, and a connector
    // that overrode a working url would break the only way to open the lead.
    expect(reply?.url).toContain("/status/");
  });

  it("drops what was said before the window", async () => {
    const { fetch: fetchStub } = socialCrawl([repliesPage1]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    const all = await source.fetchReplies(replyRequest);
    const since = new Date("2026-07-01T00:00:00.000Z");
    const recent = await source.fetchReplies({ ...replyRequest, since });

    expect(recent.replies.length).toBeLessThan(all.replies.length);
    expect(recent.replies.every((reply) => reply.postedAt > since)).toBe(true);
  });

  /**
   * **The provider's `has_more` is wrong, and this is the evidence.**
   *
   * Page one reported another page and carried a cursor. Following it returned
   * zero replies — and cost nothing, because the provider refunds a call that
   * matches nothing. So the flag over-promises and the connector's honesty
   * costs a round trip rather than a credit.
   */
  it("reports partial when the provider claims another page", async () => {
    const { fetch: fetchStub } = socialCrawl([repliesPage1]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.next.status).toBe("ready");
    expect(result.partial).toBe(true);
  });

  it("ends the walk on the empty page that claim led to, for nothing", async () => {
    const { fetch: fetchStub } = socialCrawl([repliesPage2]);
    const source = new SocialCrawlXSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies({ ...replyRequest, cursor: "sc.whatever" });

    expect(result.replies).toEqual([]);
    expect(result.next).toEqual({ status: "done" });
    // Refunded. Trusting a wrong flag cost a round trip and no money.
    expect(result.unitsConsumed).toBe(0);
  });
});

/**
 * The claim US-020's last acceptance box makes: one parser, every platform.
 *
 * The provider gives its comment endpoints the archetype `CommentList` and
 * points them at one schema. A shared name is not a shared shape, so this
 * compares the two captured payloads field by field rather than trusting the
 * catalogue.
 */
describe("one parser reads every SocialCrawl platform's replies", () => {
  function firstComment(captured: Captured): Record<string, unknown> {
    const items = (bodyOf(captured).data as { items?: readonly unknown[] }).items ?? [];
    const item = items[0] as { comment?: Record<string, unknown> };
    return item.comment ?? (item as Record<string, unknown>);
  }

  it("finds the same fields on an X reply and a YouTube comment", () => {
    const youTube = JSON.parse(
      readFileSync(new URL("./youtube-fixtures/comments-newest.json", import.meta.url), "utf8"),
    ) as { data: { items: readonly { comment: Record<string, unknown> }[] } };

    const x = Object.keys(firstComment(repliesPage1)).sort();
    const yt = Object.keys(youTube.data.items[0]?.comment ?? {}).sort();

    // YouTube adds `ext`, a bag of platform extras nothing here reads. Every
    // field the parser touches is on both.
    expect(yt.filter((key) => key !== "ext")).toEqual(x);
  });

  it("parses an X reply through the shared parser with no platform hints", () => {
    const reply = toCandidateReply(firstComment(repliesPage1), {
      parentPostExternalId: "2066207953355432118",
    });

    expect(reply?.externalId).toBe("2066217164928077884");
    expect(reply?.url).toContain("/status/");
    expect(reply?.text.length).toBeGreaterThan(0);
    expect(reply?.postedAt).toEqual(new Date("2026-06-14T17:52:15.000Z"));
  });

  it("refuses a comment missing any of the four fields it cannot invent", () => {
    const real = firstComment(repliesPage1);

    for (const missing of ["id", "url", "text", "published_at"]) {
      const { [missing]: _gone, ...rest } = real;

      // The real parent, so the refusal is caused by the missing field and not
      // by the `post_id` check below — which would make this pass for the
      // wrong reason and stop testing anything.
      expect(
        toCandidateReply(rest, { parentPostExternalId: "2066207953355432118" }),
      ).toBeUndefined();
    }
  });

  /**
   * The reply that is not a reply, found live on 2026-09-06.
   *
   * `/twitter/tweet/replies` was asked for the replies under one post and
   * returned a later post by the same account about an unrelated subject. It
   * carried no `parent_id`, no leading @mention, and a `post_id` that was not
   * the post requested. The owner opened it and said it was not a reply.
   *
   * Before this check the parent came from our own request, so the stray item
   * would have been stored as a reply to a post it was never under. That
   * reaches the classifier as context — a comment is judged against the post
   * above it — so a wrong parent makes the model read real words against a
   * conversation they had nothing to do with.
   */
  it("drops a comment that says it belongs to another post", () => {
    const real = firstComment(repliesPage1);

    expect(toCandidateReply(real, { parentPostExternalId: "2066207953355432118" })).toBeDefined();
    expect(toCandidateReply(real, { parentPostExternalId: "9999999999999999999" })).toBeUndefined();
  });

  it("keeps a comment that does not say which post it is under", () => {
    // Absence is not disagreement, and no captured page has shown one: all 137
    // comments across the X, YouTube and TikTok fixtures carry `post_id`.
    const { post_id: _gone, ...rest } = firstComment(repliesPage1);

    expect(toCandidateReply(rest, { parentPostExternalId: "2066207953355432118" })).toBeDefined();
  });
});
