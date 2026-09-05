/**
 * The SocialCrawl LinkedIn connector, driven against payloads captured from a
 * live account by `linkedin-fixtures/capture.mjs` on 2026-09-05.
 *
 * Nothing here reaches the network. The runtime's `fetch` either replays the
 * captured files or is `unreachableFetch`, so a test that tried to collect
 * anything would fail rather than spend five credits. docs/testing.md, *No
 * test spends money*.
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
import { linkedInPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { SocialCrawlLinkedInSource, socialCrawlLinkedIn, toCandidatePost } from "./linkedin.js";
import { socialCrawlProviderId } from "./provider.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./linkedin-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const searchPage1 = fixture("search-posts");
const searchPage2 = fixture("search-page-2");
const shortQuery = fixture("search-short-query");
const noResults = fixture("search-no-results");
const pastWeek = fixture("search-past-week");
const credentialsAccepted = fixture("credentials-accepted");
const credentialsRejected = fixture("credentials-rejected");
const dateRejected = fixture("date-rejected");
const contentTypeRejected = fixture("content-type-rejected");

function bodyOf(captured: Captured): Record<string, unknown> {
  return captured.body as Record<string, unknown>;
}

function dataOf(captured: Captured): Record<string, unknown> {
  return bodyOf(captured).data as Record<string, unknown>;
}

function itemsOf(captured: Captured): Record<string, unknown>[] {
  return dataOf(captured).items as Record<string, unknown>[];
}

function paginationOf(captured: Captured): Record<string, unknown> {
  return bodyOf(captured).pagination as Record<string, unknown>;
}

/** Read out of `search-posts.json` by eye. */
const searchCursor = paginationOf(searchPage1).next_cursor as string;
const firstPostId = "7500190661334249473";
const firstPostUrl = "https://www.linkedin.com/feed/update/urn:li:activity:7500190661334249473";

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
    logger: createLogger({ level: "silent", name: "socialcrawl-linkedin-test" }),
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
function cursorAt(index: number, pages: number, after = "") {
  return `${index}|${pages}|${after}`;
}

/** What the connector asked for, as a parsed query string. */
function paramsOf(call: Call | undefined): URLSearchParams {
  return new URL(call?.url ?? "https://example.invalid").searchParams;
}

/** One captured answer with its pagination replaced. */
function withPagination(captured: Captured, pagination: unknown): Captured {
  return { ...captured, body: { ...bodyOf(captured), pagination } };
}

describe("the connector's declared economics", () => {
  it("is LinkedIn fetched by SocialCrawl", () => {
    expect(socialCrawlLinkedIn.platform.id).toBe(linkedInPlatformId);
    expect(socialCrawlLinkedIn.provider.id).toBe(socialCrawlProviderId);
  });

  it("bills a credit and not a request, because one request here is five of them", () => {
    // The X connector calls its unit a request, and it is right to: one X
    // request is one credit. Reporting "1 request" here against a per-credit
    // price would tell the budget guard a poll cost a fifth of the bill.
    expect(socialCrawlLinkedIn.billableUnit).toBe("credit");
    expect(bodyOf(searchPage1).credits_used).toBe(5);

    // £15 for 2,500 credits, read from socialcrawl.dev/pricing on 2026-09-05,
    // at GBP 1 = USD 1.353 for 2026-09-04. One account, one pack, one price —
    // so this is the same number the X connector carries.
    expect(socialCrawlLinkedIn.pricePerUnitMicros).toBe(8118);
  });

  it("bounds one query at two pages, which is ten credits", () => {
    expect(socialCrawlLinkedIn.maxUnitsPerQueryPoll).toBe(10);
  });

  it("stores its posts under the platform the schema knows", () => {
    expect(() => assertSourcesCanBeStored([socialCrawlLinkedIn.platform.id])).not.toThrow();
  });
});

describe("reading a captured record", () => {
  const records = itemsOf(searchPage1);

  it("keeps only the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(records[0]);

    expect(post).toEqual({
      externalId: firstPostId,
      url: firstPostUrl,
      author: "li-user-2",
      text: expect.any(String) as unknown as string,
      postedAt: new Date("2026-08-31T14:30:00.552Z"),
    });
  });

  it("reads the post text out of `title`, which is what this provider calls it", () => {
    // Not a heading: the captured item's `title` held five paragraphs. So the
    // text is filled and `CandidatePost.title` is left empty, because a title
    // this platform does not have would be the body repeated.
    expect(toCandidatePost(records[0])?.text).toBe(records[0]?.title);
    expect(toCandidatePost(records[0])).not.toHaveProperty("title");
    expect(toCandidatePost(records[0])).not.toHaveProperty("channel");
  });

  it("identifies a post by LinkedIn's own activity id, which deduplication is keyed on", () => {
    for (const record of records) {
      expect(toCandidatePost(record)?.externalId).toMatch(/^[0-9]+$/);
    }
  });

  it("gives the same post the same id on a second call, which is what makes a poll cheap", () => {
    // `search-repeat.json` is the same query sent again. Ten ids came back and
    // all ten matched, so a second poll stores no new row.
    const repeat = fixture("search-repeat");
    const first = itemsOf(searchPage1).map((record) => toCandidatePost(record)?.externalId);
    const again = itemsOf(repeat).map((record) => toCandidatePost(record)?.externalId);

    expect(again).toEqual(first);
  });

  it("stores the profile slug rather than the display name", () => {
    const real = records[0] as Record<string, unknown>;
    const author = real.author as Record<string, unknown>;

    // A display name is not unique and not stable; it is the field a person
    // edits when they add a credential to it. The slug identifies the account.
    expect(toCandidatePost({ ...real, author: { ...author, name: "Someone Else" } })?.author).toBe(
      "li-user-2",
    );

    // A company page is an author here too, and it is read the same way.
    expect(
      toCandidatePost({
        ...real,
        author: { url: "https://www.linkedin.com/company/acme/posts" },
      })?.author,
    ).toBe("acme");

    expect(toCandidatePost({ ...real, author: undefined })).not.toHaveProperty("author");
  });

  it("drops a record with no id, no url or no timestamp, rather than repairing it", () => {
    const real = records[0] as Record<string, unknown>;

    const { id, ...noId } = real;
    const { created_at, ...noTime } = real;
    const { url, ...noUrl } = real;

    expect(toCandidatePost(noId)).toBeUndefined();
    expect(toCandidatePost(noTime)).toBeUndefined();
    expect(toCandidatePost(noUrl)).toBeUndefined();
    expect(toCandidatePost({ ...real, created_at: "not a date" })).toBeUndefined();
    expect(toCandidatePost(null)).toBeUndefined();
    expect(toCandidatePost("not a record")).toBeUndefined();
    expect(toCandidatePost({})).toBeUndefined();
  });

  it("gives the classifier an empty string when a post is an image with no words", () => {
    const real = records[0] as Record<string, unknown>;

    expect(toCandidatePost({ ...real, title: "" })?.text).toBe("");
    expect(toCandidatePost({ ...real, title: null })?.text).toBe("");
  });
});

describe("searching", () => {
  it("returns the posts and reports what the provider says it charged", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(10);
    expect(result.posts[0]?.externalId).toBe(firstPostId);

    // Five credits for ten posts. `unitsConsumed` is the provider's own
    // `credits_used` and never the length of the page.
    expect(result.unitsConsumed).toBe(5);
    expect(result.unitsConsumed).not.toBe(result.posts.length);
  });

  it("sends the key in the header the provider wants, to the LinkedIn endpoint", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await source.search(request());

    expect(stub.calls[0]?.apiKey).toBe(credentials.apiKey);
    expect(stub.calls[0]?.url).toContain("/v1/linkedin/search/posts");
  });

  it("passes a monitor's words through whole, because a long phrase works here", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await source.search(request());

    // Six words returned ten posts, eight of them about flaky and brittle
    // tests. The same six words on X returned anime and Bitcoin, which is why
    // the two platforms carry different `maxQueryWords`.
    expect(paramsOf(stub.calls[0]).get("query")).toBe("end to end tests keep breaking");
    expect(paramsOf(stub.calls[0]).get("sort")).toBeNull();
  });

  it("asks for the narrowest window that still covers what the caller wants", async () => {
    const windows: [string, string][] = [
      ["2026-09-05T00:00:00.000Z", "past_24h"],
      ["2026-09-01T00:00:00.000Z", "past_week"],
      ["2026-08-20T00:00:00.000Z", "past_month"],
    ];

    for (const [since, expected] of windows) {
      const stub = socialCrawl([searchPage1]);
      const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

      await source.search(
        request({ query: { queries: ["flaky tests"], channels: [], since: new Date(since) } }),
      );

      expect(paramsOf(stub.calls[0]).get("date_posted")).toBe(expected);
    }

    // The provider listed those three itself when the capture sent an invalid
    // value. There is nothing finer and no way to name a date.
    expect(bodyOf(dateRejected).error).toMatchObject({
      message: expect.stringContaining(
        "Allowed values: past_24h, past_week, past_month",
      ) as unknown as string,
    });
  });

  it("sends no window at all when the caller wants more than a month, or no date", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await source.search(request());
    await source.search(
      request({
        query: { queries: ["flaky tests"], channels: [], since: new Date("2026-01-01T00:00:00Z") },
      }),
    );

    // Widening is the safe direction: the call costs five credits either way,
    // and a window narrower than `since` loses posts silently.
    expect(paramsOf(stub.calls[0]).get("date_posted")).toBeNull();
    expect(paramsOf(stub.calls[1]).get("date_posted")).toBeNull();
  });

  it("cuts to the exact time as well, because the window is only ever a whole day", async () => {
    const stub = socialCrawl([shortQuery]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const since = new Date("2026-09-01T00:00:00.000Z");
    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since } }),
    );

    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThan(itemsOf(shortQuery).length);
    for (const post of result.posts)
      expect(post.postedAt.getTime()).toBeGreaterThan(since.getTime());
  });

  it("keeps paging when a whole page is older than the monitor asked for", async () => {
    const stub = socialCrawl([shortQuery]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date("2026-09-06T00:00:00.000Z"),
        },
      }),
    );

    // This is the one rule the X connector has that this one must not copy.
    // There, a page entirely older than `since` ends the query, because the
    // list is newest first. Here it is ordered by relevance — the captured
    // page ran 22 August, 22 August, 4 September, 31 August, 15 August — so an
    // old page says nothing about the next one.
    const dates = itemsOf(shortQuery).map((item) => String(item.created_at));
    expect(dates).not.toEqual([...dates].sort().reverse());

    expect(result.posts).toHaveLength(0);
    expect(result.next).toEqual({
      status: "ready",
      cursor: cursorAt(0, 1, paginationOf(shortQuery).next_cursor as string),
    });
  });

  it("hands back the provider's cursor and follows it on the next call", async () => {
    const stub = socialCrawl([searchPage1, searchPage2]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    expect(first.next).toEqual({ status: "ready", cursor: cursorAt(0, 1, searchCursor) });

    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    expect(paramsOf(stub.calls[1]).get("cursor")).toBe(searchCursor);

    // The documentation describes no pagination for this endpoint. The capture
    // followed the cursor anyway and page two carried ten posts with none of
    // page one's among them, which is what stops the connector buying the same
    // page twice at five credits a time.
    const firstIds = first.posts.map((post) => post.externalId);
    for (const post of second.posts) expect(firstIds).not.toContain(post.externalId);
    expect(second.unitsConsumed).toBe(5);
  });

  it("finishes a query when the provider says there is no more", async () => {
    // Every captured answer carried `has_more: true`, so this asserts our half
    // of a contract the provider has not yet shown us the other side of.
    const last = withPagination(searchPage1, { has_more: false, next_cursor: searchCursor });
    const stub = socialCrawl([last]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    // The flag wins over the cursor beside it. Stopping early costs a post
    // that the next poll finds; paging on costs five credits for nothing.
    expect(result.next).toEqual({ status: "done" });
  });

  it("finishes a query when the answer carries no cursor at all", async () => {
    const stub = socialCrawl([withPagination(searchPage1, undefined)]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(10);
    expect(result.next).toEqual({ status: "done" });
  });

  it("stops one query after its share of the poll, rather than paging until the cap does", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const first = await source.search(request());
    const second = await source.search(
      request({ cursor: (first.next as { cursor: string }).cursor }),
    );

    // Both pages reported a cursor, and the connector still stopped: two pages
    // is ten credits, and the next poll starts the query again rather than
    // paging deeper into a list the provider has already ranked.
    expect(paginationOf(searchPage1).has_more).toBe(true);
    expect(second.next).toEqual({ status: "done" });
  });

  it("moves to the next query when one is finished", async () => {
    const stub = socialCrawl([withPagination(searchPage1, { has_more: false })]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["first", "second"], channels: [] } }),
    );

    expect(result.next).toEqual({ status: "ready", cursor: cursorAt(1, 0) });
  });

  it("asks for nothing at all when the monitor named no query", async () => {
    const source = new SocialCrawlLinkedInSource(runtimeWith(unreachableFetch));

    const result = await source.search(request({ query: { queries: [], channels: [] } }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
  });

  it("ignores a monitor's channels rather than guessing what the parameter takes", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await source.search(
      request({ query: { queries: ["flaky tests"], channels: ["acme", "globex"] } }),
    );

    // `from_member` and `from_company` are documented without saying whether
    // they take a URL, a slug or an urn, and a wrong guess costs five credits
    // and teaches nothing. US-028 left them unasked. One request went out, for
    // the query, and none for the channels.
    expect(stub.calls).toHaveLength(1);
    expect(paramsOf(stub.calls[0]).get("from_member")).toBeNull();
    expect(paramsOf(stub.calls[0]).get("from_company")).toBeNull();
  });

  it("never asks for a content type, because none of the values is ordinary text", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await source.search(request());

    // The provider listed its own values: videos, photos, jobs, live_videos,
    // documents, collaborative_articles. Every one of them narrows to media a
    // monitor is not reading for, so the parameter is left off.
    expect(paramsOf(stub.calls[0]).get("content_type")).toBeNull();
    expect(bodyOf(contentTypeRejected).error).toMatchObject({
      message: expect.stringContaining("videos, photos, jobs") as unknown as string,
    });
  });

  it("bills a query that matches nothing at full price, and it is not an empty page", async () => {
    const stub = socialCrawl([noResults]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request({ query: { queries: ["nonsense"], channels: [] } }));

    // A phrase that cannot occur returned ten unrelated posts and cost five
    // credits. On X the same call is refunded and comes back empty. So this
    // connector has no empty-page signal to read, and a vague query is the
    // most expensive way in this product to receive nothing useful.
    expect(bodyOf(noResults).credits_used).toBe(5);
    expect(result.unitsConsumed).toBe(5);
    expect(result.posts).toHaveLength(10);
  });

  it("records a cached answer as the zero the provider reported", async () => {
    const cachedAnswer: Captured = {
      ...searchPage1,
      body: { ...bodyOf(searchPage1), cached: true, credits_used: 0 },
    };
    const stub = socialCrawl([cachedAnswer]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    // Measured: the same query sent twice came back flagged `cached: true` for
    // no credits. It is recorded as the zero it was, and nothing counts on it
    // happening — the window is the provider's and it is not documented.
    expect(result.unitsConsumed).toBe(0);
    expect(result.posts).toHaveLength(10);
  });

  it("returns no more than the caller asked for, which costs nothing here", async () => {
    const stub = socialCrawl([searchPage1]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request({ limit: 3 }));

    // The credits were spent on the request, not on the posts, so trimming
    // wastes no money. On a provider that bills per record it would waste all
    // of it.
    expect(result.posts).toHaveLength(3);
    expect(result.unitsConsumed).toBe(5);
  });

  it("refuses a cursor it did not issue, rather than reporting the query finished", async () => {
    const source = new SocialCrawlLinkedInSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-a-cursor" }))).rejects.toThrow(
      /was not issued by this source/,
    );
    await expect(source.search(request({ cursor: "-1|0|" }))).rejects.toThrow();
    await expect(source.search(request({ cursor: "0|x|" }))).rejects.toThrow();
  });

  it("finishes when the cursor points past the queries the monitor still has", async () => {
    const source = new SocialCrawlLinkedInSource(runtimeWith(unreachableFetch));

    // A monitor edited between two polls. Starting again next poll is the safe
    // answer, and asking for a query that no longer exists is not.
    const result = await source.search(request({ cursor: cursorAt(4, 0) }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
  });

  it("hands a rate limit up with the place it had reached, so the wait costs no page", async () => {
    const limited: Captured = {
      httpStatus: 429,
      body: { success: false, error: { message: "Rate limit exceeded" } },
    };
    const stub = socialCrawl([limited]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const result = await source.search(request({ cursor: cursorAt(0, 1, "abc") }));

    // Never measured against the real provider: no capture run has been rate
    // limited. This is our half of that contract.
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({
      status: "wait",
      retryAfter: new Date(now.getTime() + 60_000),
      cursor: cursorAt(0, 1, "abc"),
    });
  });

  it("repeats the provider's own sentence when it refuses the query", async () => {
    const stub = socialCrawl([dateRejected]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await expect(source.search(request())).rejects.toThrow(/Allowed values: past_24h/);
  });
});

describe("checking a key", () => {
  it("accepts a key the provider let past authentication, and pays nothing for it", async () => {
    const stub = socialCrawl([credentialsAccepted]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    await expect(source.validateCredentials(credentials)).resolves.toEqual({ valid: true });

    // The probe sends no query, so the provider refuses on the parameter after
    // it has accepted the key. That matters more here than on X: a probe
    // billed at five credits would charge a person for typing their key
    // correctly.
    expect(stub.calls[0]?.url).toContain("/v1/linkedin/search/posts");
    expect(paramsOf(stub.calls[0]).get("query")).toBeNull();
    expect(bodyOf(credentialsAccepted).credits_used).toBe(0);
    expect(bodyOf(credentialsAccepted).credits_remaining).toBe(71);
  });

  it("refuses a key with the provider's own words, and bills nothing to find out", async () => {
    const stub = socialCrawl([credentialsRejected]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials({ apiKey: "wrong" });

    expect(check).toEqual({
      valid: false,
      reason: expect.stringContaining("Keys start with 'sc_'") as unknown as string,
    });
    expect(bodyOf(credentialsRejected).credits_used).toBe(0);
  });

  it("asks for a key before it asks the provider", async () => {
    const source = new SocialCrawlLinkedInSource(runtimeWith(unreachableFetch));

    await expect(source.validateCredentials({})).resolves.toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });

  it("separates a provider that is down from a key that is wrong", async () => {
    const down: Captured = { httpStatus: 502, body: "upstream unavailable" };
    const stub = socialCrawl([down]);
    const source = new SocialCrawlLinkedInSource(runtimeWith(stub.fetch));

    // An outage must not tell a person to replace a key that works.
    // docs/secrets.md, *Testing before storing*.
    await expect(source.validateCredentials(credentials)).rejects.toThrow(
      /SocialCrawl answered 502/,
    );
  });

  it("will not search without a key", async () => {
    const source = new SocialCrawlLinkedInSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ credentials: {} }))).rejects.toThrow(
      /No SocialCrawl API key/,
    );
  });
});

describe("the window the capture measured", () => {
  it("narrows what the provider returns, which is why the parameter is sent", () => {
    const withoutWindow = itemsOf(shortQuery)
      .map((item) => String(item.created_at))
      .sort();
    const withWindow = itemsOf(pastWeek)
      .map((item) => String(item.created_at))
      .sort();

    // The same query, one call with `date_posted=past_week` and one without.
    // The oldest post moved from 15 August to 30 August against a capture run
    // on 5 September, so the parameter is honoured rather than accepted and
    // ignored.
    expect(withoutWindow[0]?.slice(0, 10)).toBe("2026-08-15");
    expect(withWindow[0]?.slice(0, 10)).toBe("2026-08-30");
  });
});
