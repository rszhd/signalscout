/**
 * The Apify LinkedIn connector, driven against payloads captured from a live
 * account by `linkedin-fixtures/capture.mjs` on 2026-09-07.
 *
 * Nothing here reaches the network. The runtime's `fetch` replays the captured
 * files, so a test that tried to run an actor would fail rather than spend
 * anything. docs/testing.md, *No test spends money*.
 *
 * The literals below were read out of the fixtures by eye. Re-running the
 * capture collects different posts and will change them; that is a deliberate
 * edit to make at the same time, not a reason to derive the expected values
 * from the code that produces them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { linkedInPlatformId } from "../../platforms.js";
import { createSourceRegistry } from "../../registry.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SearchResult, SourceRuntime } from "../../types.js";
import { toCandidatePost as toSocialCrawlPost } from "../socialcrawl/linkedin.js";
import { ApifyLinkedInSource, apifyLinkedIn, toCandidatePost } from "./linkedin.js";
import { apifyProviderId } from "./provider.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./linkedin-fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

const searchItems = fixture("search-by-date") as Record<string, unknown>[];
const noResultItems = fixture("search-no-results") as Record<string, unknown>[];
const tokenRejected = fixture("credentials-rejected") as {
  httpStatus: number;
  body: unknown;
};

/** Read out of `search-by-date.json` by eye. */
const firstPostId = "7502587310513893376";
const firstPostAt = new Date("2026-09-07T04:43:26.158Z");

/**
 * What the run object said, at the two moments US-056 read it.
 *
 * The first is what Apify reports when a run's status changes; the second is
 * the settled bill a few seconds later. Ten posts at $0.002 plus $0.00005 for
 * the run. The gap between them is the reason `client.ts` exists in the shape
 * it does.
 */
const runId = "EoO5MEFVNbq8Dui5B";
const datasetId = "a-dataset";

function runObject(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: runId,
      status: "SUCCEEDED",
      defaultDatasetId: datasetId,
      usageTotalUsd: 0.02005,
      chargedEventCounts: { "apify-actor-start": 1, post: 10 },
      ...overrides,
    },
  };
}

const now = new Date("2026-09-07T05:15:00.000Z");

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly token: string | null;
  readonly body: unknown;
}

/**
 * A `fetch` that answers by URL rather than by order.
 *
 * The connector makes three different calls — start a run, ask its status, read
 * its dataset — and a queue would tie every test to the order they happen in.
 * Matching on the path lets a test say what each endpoint answers and leaves
 * the connector free to ask in whatever order it likes.
 */
function apify(routes: {
  start?: Reply;
  /** A list when a test needs the run to answer differently each time it is asked. */
  run?: Reply | Reply[];
  dataset?: Reply;
  user?: Reply;
}) {
  const calls: Call[] = [];
  const runAnswers = Array.isArray(routes.run) ? [...routes.run] : undefined;

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);

    calls.push({
      url,
      method: init?.method ?? "GET",
      token: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const nextRun = (): Reply | undefined =>
      runAnswers
        ? ((runAnswers.length === 1 ? runAnswers[0] : runAnswers.shift()) as Reply)
        : (routes.run as Reply | undefined);

    const answer: Reply | undefined = url.includes("/users/me")
      ? routes.user
      : url.includes("/datasets/")
        ? routes.dataset
        : url.includes("/runs") && (init?.method ?? "GET") === "POST"
          ? routes.start
          : nextRun();

    if (!answer) throw new Error(`the test planned no answer for ${url}`);

    return Promise.resolve(
      new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), {
        status: answer.status,
      }),
    );
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    // The settle loop sleeps between reads. Resolving at once keeps the test
    // fast without changing how many times it asks.
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "apify-linkedin-test" }),
  };
}

const credentials = { apiToken: "an-apify-token" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["flaky tests"], channels: [] },
    credentials,
    ...overrides,
  };
}

function sourceFor(routes: Parameters<typeof apify>[0]) {
  const provider = apify(routes);
  return { source: new ApifyLinkedInSource(runtimeWith(provider.fetch)), provider };
}

/** The cursor grammar, written out here so a test reads as the caller sees it. */
function cursorAt(index: number, run = "") {
  return `${index}|${run}`;
}

/**
 * The window one call asked for, or a failure that says the call never
 * happened. Reading `undefined` as "no window" would pass for the wrong reason.
 */
function windowSent(call: Call | undefined): string | undefined {
  if (!call) throw new Error("the test expected a call the connector did not make");
  return (call.body as { postedLimit?: string }).postedLimit;
}

function cursorOf(next: SearchResult["next"]): string {
  if (next.status === "done") throw new Error("expected a cursor, the walk was done");
  return next.cursor as string;
}

const startedRun = { status: 201, body: { data: { id: runId, status: "READY" } } };
const finishedRun = { status: 200, body: runObject() };
const dataset = { status: 200, body: searchItems };

describe("the connector's declared economics", () => {
  it("is LinkedIn fetched by Apify", () => {
    expect(apifyLinkedIn.platform.id).toBe(linkedInPlatformId);
    expect(apifyLinkedIn.provider.id).toBe(apifyProviderId);
  });

  it("bills a post, because the actor charges for every one it returns", () => {
    // Not a run. A run returning twenty-five posts costs twenty-five times one
    // returning one, which is the opposite of both other LinkedIn providers.
    expect(apifyLinkedIn.billableUnit).toBe("post");
    // The FREE and BRONZE tier price from the actor's own pricingInfos. Its
    // store page quotes $1.50 per 1,000, which is the GOLD price.
    expect(apifyLinkedIn.pricePerUnitMicros).toBe(2000);
  });

  it("asks for a token, and the field name is what builds APIFY_API_TOKEN", () => {
    expect(apifyLinkedIn.provider.credentialFields.map((field) => field.name)).toEqual([
      "apiToken",
    ]);
  });

  it("stores its posts under the platform the schema knows", () => {
    expect(() => assertSourcesCanBeStored([apifyLinkedIn.platform.id])).not.toThrow();
  });

  it("registers beside the other provider for the same platform", () => {
    const registry = createSourceRegistry({
      definitions: [apifyLinkedIn],
      runtime: runtimeWith(apify({}).fetch),
    });

    expect(registry.has(linkedInPlatformId, apifyProviderId)).toBe(true);
  });
});

describe("reading a captured record", () => {
  it("keeps only the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(searchItems[0]);

    expect(post).toEqual({
      externalId: firstPostId,
      url: (searchItems[0] as { linkedinUrl: string }).linkedinUrl,
      author: "li-user-1",
      text: expect.any(String) as unknown as string,
      postedAt: firstPostAt,
    });
  });

  it("reads the timestamp out of the object the actor wraps it in", () => {
    // `postedAt` is `{ timestamp, date, postedAgoShort, postedAgoText }`. The
    // last two are about when somebody looked, not when the post was written.
    const post = toCandidatePost(searchItems[0]);

    expect(post?.postedAt).toEqual(firstPostAt);
  });

  it("falls back to the epoch when the ISO date is missing", () => {
    const post = toCandidatePost({
      ...searchItems[0],
      postedAt: { timestamp: firstPostAt.getTime() },
    });

    expect(post?.postedAt).toEqual(firstPostAt);
  });

  it("reads the post text from `content`, and leaves the title empty", () => {
    // This platform has no title. Repeating the body into one would be a
    // fiction, and the captured posts run to a median of 1,567 characters.
    const post = toCandidatePost(searchItems[0]);

    expect(post?.text.length).toBeGreaterThan(500);
    expect(post?.title).toBeUndefined();
  });

  it("takes the author from the profile slug, not from a display name", () => {
    // The author URL carries a query string holding the member's own id. The
    // slug comes from the path, so everything in the query goes with it.
    const post = toCandidatePost(searchItems[0]);

    expect(post?.author).toBe("li-user-1");
    expect(post?.author).not.toContain("miniProfileUrn");
  });

  it("reads every record in the captured run", () => {
    expect(searchItems).toHaveLength(10);
    expect(searchItems.map((item) => toCandidatePost(item)).filter(Boolean)).toHaveLength(10);
  });

  it("drops a record with no id or no timestamp, rather than inventing one", () => {
    expect(toCandidatePost({ ...searchItems[0], id: undefined })).toBeUndefined();
    expect(toCandidatePost({ ...searchItems[0], postedAt: undefined })).toBeUndefined();
  });
});

describe("the identity three providers share", () => {
  it("reads the same activity id as the SocialCrawl parser", () => {
    // `posts` is keyed by `(source, external_id)` with the provider outside the
    // key, so a post already collected through SocialCrawl must not be stored
    // and billed again here.
    const activityId = firstPostId;

    const fromSocialCrawl = toSocialCrawlPost({
      id: activityId,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}`,
      created_at: "2026-09-07T04:43:26.158Z",
      title: "a post about flaky tests",
    });

    expect(toCandidatePost(searchItems[0])?.externalId).toBe(fromSocialCrawl?.externalId);
  });

  it("reads the ids of a whole captured run, all of them distinct", () => {
    const ids = searchItems
      .map((item) => toCandidatePost(item)?.externalId)
      .filter((id): id is string => id !== undefined);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });
});

describe("starting a run", () => {
  it("sends the query, a real post limit and the date sort", async () => {
    const { source, provider } = sourceFor({ start: startedRun });

    await source.search(request());

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.method).toBe("POST");
    expect(provider.calls[0]?.url).toContain("/acts/harvestapi~linkedin-post-search/runs");
    expect(provider.calls[0]?.token).toBe(`Bearer ${credentials.apiToken}`);
    expect(provider.calls[0]?.body).toEqual({
      searchQueries: ["flaky tests"],
      maxPosts: 25,
      sortBy: "date",
    });
  });

  it("never sends maxPosts: 0, which would mean every post there is", async () => {
    const { source, provider } = sourceFor({ start: startedRun });

    await source.search(request());

    const body = provider.calls[0]?.body as { maxPosts: number };
    expect(body.maxPosts).toBeGreaterThan(0);
  });

  it("charges nothing for starting, and hands the wait back with the run id", async () => {
    // Nothing is billed by starting. The whole charge lands on the poll that
    // reads the run, which is the same split the Bright Data connector makes.
    const { source } = sourceFor({ start: startedRun });

    const result = await source.search(request());

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({
      status: "wait",
      retryAfter: new Date(now.getTime() + 5000),
      cursor: cursorAt(0, runId),
    });
  });
});

describe("finishing the run a cursor names", () => {
  it("reads that run rather than starting another", async () => {
    // The whole reason the run id is in the cursor. This provider charges per
    // post returned, so a resume that started a second run would buy the same
    // twenty-five posts again and deduplication would hide it by storing
    // nothing new. BUG-001's lesson, at a higher price.
    const { source, provider } = sourceFor({ run: finishedRun, dataset });

    await source.search(request({ cursor: cursorAt(0, runId) }));

    expect(provider.calls.every((call) => call.method === "GET")).toBe(true);
    expect(provider.calls.some((call) => call.url.includes(`/actor-runs/${runId}`))).toBe(true);
    expect(provider.calls.some((call) => call.url.includes(`/datasets/${datasetId}/items`))).toBe(
      true,
    );
  });

  it("returns the posts and finishes when the monitor named one query", async () => {
    const { source } = sourceFor({ run: finishedRun, dataset });

    const result = await source.search(request({ cursor: cursorAt(0, runId) }));

    expect(result.posts).toHaveLength(10);
    expect(result.next).toEqual({ status: "done" });
  });

  it("moves to the next query when the monitor named more", async () => {
    const { source } = sourceFor({ run: finishedRun, dataset });

    const result = await source.search(
      request({
        query: { queries: ["flaky tests", "brittle selectors"], channels: [] },
        cursor: cursorAt(0, runId),
      }),
    );

    expect(cursorOf(result.next)).toBe(cursorAt(1));
  });

  it("waits again while the run is still going, and buys nothing", async () => {
    const { source } = sourceFor({
      run: { status: 200, body: { data: { id: runId, status: "RUNNING" } } },
    });

    const result = await source.search(request({ cursor: cursorAt(0, runId) }));

    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({
      status: "wait",
      retryAfter: new Date(now.getTime() + 5000),
      cursor: cursorAt(0, runId),
    });
  });

  it("refuses a cursor it did not issue", async () => {
    const { source } = sourceFor({ start: startedRun });

    await expect(source.search(request({ cursor: "not-a-cursor" }))).rejects.toThrow(
      /was not issued by this source/,
    );
  });
});

describe("what a run cost", () => {
  /**
   * The failure this connector's client exists to prevent.
   *
   * Apify charges a pay-per-event actor after the run finishes. US-056 read a
   * run that had just returned ten posts and got $0.00005 — the start event
   * alone — then $0.02005 seconds later. A guard fed the first number would
   * price every poll at five thousandths of a cent and refuse nothing.
   */
  it("waits for the bill to settle rather than reading it at completion", async () => {
    const { source } = sourceFor({
      run: [
        { status: 200, body: runObject({ usageTotalUsd: 0.00005, chargedEventCounts: {} }) },
        { status: 200, body: runObject() },
        { status: 200, body: runObject() },
      ],
      dataset,
    });

    const result = await source.search(request({ cursor: cursorAt(0, runId) }));

    // $0.02005 is 20,050 micro-dollars, which is 10.025 posts at 2,000 each,
    // rounded up. Reading the first answer would have given 1.
    expect(result.unitsConsumed).toBe(11);
  });

  it("charges for a run that matched nothing, because an empty poll is not free", async () => {
    // Measured: an impossible phrase returned `[]` and was billed $0.00105 — a
    // `no-result` event plus the run. Counting posts would report it as free
    // and let a monitor make them all month.
    const { source } = sourceFor({
      run: {
        status: 200,
        body: runObject({
          usageTotalUsd: 0.00105,
          chargedEventCounts: { "apify-actor-start": 1, "no-result": 1 },
        }),
      },
      dataset: { status: 200, body: noResultItems },
    });

    const result = await source.search(request({ cursor: cursorAt(0, runId) }));

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(1);
  });
});

describe("the date window", () => {
  const cases = [
    { since: 30 * 60 * 1000, value: "1h" },
    { since: 5 * 60 * 60 * 1000, value: "24h" },
    { since: 3 * 24 * 60 * 60 * 1000, value: "week" },
    { since: 20 * 24 * 60 * 60 * 1000, value: "month" },
    { since: 60 * 24 * 60 * 60 * 1000, value: "3months" },
    { since: 150 * 24 * 60 * 60 * 1000, value: "6months" },
    { since: 300 * 24 * 60 * 60 * 1000, value: "year" },
  ] as const;

  for (const { since, value } of cases) {
    it(`asks for ${value} when the monitor last looked that recently`, async () => {
      const { source, provider } = sourceFor({ start: startedRun });

      await source.search(
        request({
          query: {
            queries: ["flaky tests"],
            channels: [],
            since: new Date(now.getTime() - since),
          },
        }),
      );

      expect(windowSent(provider.calls[0])).toBe(value);
    });
  }

  it("sends no window when the monitor has never looked", async () => {
    const { source, provider } = sourceFor({ start: startedRun });

    await source.search(request());

    expect(windowSent(provider.calls[0])).toBeUndefined();
  });

  it("makes the exact cut itself, because the window is a named range at best", async () => {
    const { source } = sourceFor({ run: finishedRun, dataset });

    const since = new Date("2026-09-07T04:45:00.000Z");

    const result = await source.search(
      request({
        query: { queries: ["flaky tests"], channels: [], since },
        cursor: cursorAt(0, runId),
      }),
    );

    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThan(10);
    expect(result.posts.every((post) => post.postedAt > since)).toBe(true);
  });
});

describe("paging is never stopped by a page that looks old", () => {
  /**
   * `sortBy: "date"` selects recent posts and does not order them: the captured
   * ten came back 04:43, 04:30, 04:29, 05:15, 05:14, 04:48, 04:37, 04:11,
   * 04:04, 05:12. So no page may be read as older than the next.
   */
  it("the captured run really is out of date order", () => {
    const dates = searchItems.map((item) => (item.postedAt as { date: string }).date);
    const sorted = [...dates].sort().reverse();

    expect(dates).not.toEqual(sorted);
  });

  it("moves to the next query even when every post falls before `since`", async () => {
    const { source } = sourceFor({ run: finishedRun, dataset });

    const result = await source.search(
      request({
        query: {
          queries: ["flaky tests", "brittle selectors"],
          channels: [],
          since: new Date("2026-09-07T06:00:00.000Z"),
        },
        cursor: cursorAt(0, runId),
      }),
    );

    expect(result.posts).toEqual([]);
    expect(cursorOf(result.next)).toBe(cursorAt(1));
  });
});

describe("a monitor that named only channels", () => {
  it("buys nothing, because this actor takes queries and author URLs", async () => {
    const { source, provider } = sourceFor({ start: startedRun });

    const result = await source.search(
      request({ query: { queries: [], channels: ["some-company"] } }),
    );

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("checking a token", () => {
  it("reads the account, which runs no actor and so charges nothing", async () => {
    const { source, provider } = sourceFor({
      user: { status: 200, body: { data: { plan: { id: "FREE" } } } },
    });

    await expect(source.validateCredentials(credentials)).resolves.toEqual({ valid: true });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.url).toContain("/users/me");
    expect(provider.calls[0]?.url).not.toContain("/acts/");
  });

  it("refuses a token the provider rejected, and repeats what it said", async () => {
    const { source } = sourceFor({
      user: { status: tokenRejected.httpStatus, body: tokenRejected.body },
    });

    const check = await source.validateCredentials(credentials);

    expect(tokenRejected.httpStatus).toBe(401);
    expect(check).toEqual({
      valid: false,
      reason: expect.stringContaining("authentication token is not valid") as unknown as string,
    });
  });

  it("throws rather than blaming the token when the provider is unreachable", async () => {
    // A refusal and an outage lead to different actions. A person whose
    // provider is down must not be told to replace a working token.
    const { source } = sourceFor({ user: { status: 503, body: "upstream is down" } });

    await expect(source.validateCredentials(credentials)).rejects.toThrow(/Apify answered 503/);
  });

  it("asks for a token rather than calling the provider without one", async () => {
    const { source, provider } = sourceFor({});

    const check = await source.validateCredentials({});

    expect(check).toEqual({ valid: false, reason: "Enter your Apify API token." });
    expect(provider.calls).toHaveLength(0);
  });
});
