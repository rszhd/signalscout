/**
 * The HarvestAPI LinkedIn connector, driven against answers captured from a
 * live account by `linkedin-fixtures/capture.mjs` on 2026-09-24 (US-386).
 *
 * Nothing here reaches the network. The runtime's `fetch` replays the captured
 * files, so a test that tried to collect anything would fail rather than spend.
 *
 * The literals below were read out of the fixtures by eye. Re-running the
 * capture collects different posts and will change them; that is a deliberate
 * edit to make at the same time.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { linkedInPlatformId } from "../../platforms.js";
import { createSourceRegistry } from "../../registry.js";
import type { ReplyRequest, SearchRequest, SourceRuntime } from "../../types.js";
import { apifyLinkedIn } from "../apify/linkedin.js";
import { HarvestApiError } from "./client.js";
import { HarvestApiLinkedInSource, harvestApiLinkedIn } from "./linkedin.js";
import { harvestApiProviderId } from "./provider.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

const manifest = JSON.parse(
  readFileSync(new URL("./linkedin-fixtures/manifest.json", import.meta.url), "utf8"),
) as { files: { file: string; httpStatus: number }[] };

/** A captured body, paired with the status the manifest recorded for it. */
function fixture(name: string): Captured {
  const file = `${name}.json`;
  const entry = manifest.files.find((candidate) => candidate.file === file);
  if (!entry) throw new Error(`${file} is not in manifest.json`);

  return {
    httpStatus: entry.httpStatus,
    body: JSON.parse(
      readFileSync(new URL(`./linkedin-fixtures/${file}`, import.meta.url), "utf8"),
    ) as unknown,
  };
}

const searchByDate = fixture("search-by-date");
const noResults = fixture("search-no-results");
const comments = fixture("comments");
const credentialsRejected = fixture("credentials-rejected");
const probeRejected = fixture("probe-rejected");

/** Read out of `search-by-date.json` by eye. */
const firstPostId = "7508663633128865792";
const firstPostUrl = "https://www.linkedin.com/posts/activity-7508663633128865792-pajx";
const firstPostAt = new Date("2026-09-23T23:08:34.362Z");

/** Read out of `comments.json`: the post the four comments hang under. */
const commentedPostId = "7508514943374266368";

const now = new Date("2026-09-24T00:00:00.000Z");

interface Call {
  readonly url: URL;
  readonly key: string | null;
}

/** A `fetch` that answers from the captured files; the last answer repeats. */
function harvestApi(answers: readonly Captured[]) {
  const queue = [...answers];
  const calls: Call[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: new URL(String(input)), key: new Headers(init?.headers).get("x-api-key") });

    if (queue.length === 0) throw new Error(`the test planned no answer for ${String(input)}`);
    const answer = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), { status: answer.httpStatus }),
    );
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "harvestapi-linkedin-test" }),
  };
}

function sourceFor(answers: readonly Captured[]) {
  const provider = harvestApi(answers);
  return {
    source: new HarvestApiLinkedInSource(runtimeWith(provider.fetch)),
    calls: provider.calls,
  };
}

const credentials = { apiKey: "a-harvestapi-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: ["flaky tests"], channels: [] }, credentials, ...overrides };
}

function hoursBefore(hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

describe("the connector's declaration", () => {
  it("bills a request at the Starter price, one page a query a poll", () => {
    expect(harvestApiLinkedIn.provider.id).toBe(harvestApiProviderId);
    expect(harvestApiLinkedIn.billableUnit).toBe("request");
    expect(harvestApiLinkedIn.pricePerUnitMicros).toBe(4000);
    expect(harvestApiLinkedIn.replyPricePerUnitMicros).toBe(4000);
    expect(harvestApiLinkedIn.postsPerUnit).toBe(50);
    expect(harvestApiLinkedIn.maxUnitsPerQueryPoll).toBe(1);
    expect(harvestApiLinkedIn.notOffered).toBeUndefined();
  });

  it("sits beside the Apify connector in the registry, under its own address", () => {
    const registry = createSourceRegistry({
      definitions: [apifyLinkedIn, harvestApiLinkedIn],
      runtime: runtimeWith(harvestApi([]).fetch),
    });

    expect(registry.get(linkedInPlatformId, harvestApiProviderId).provider.id).toBe(
      harvestApiProviderId,
    );
  });
});

describe("search", () => {
  it("asks for one page by date with the key in its header, and charges one request", async () => {
    const { source, calls } = sourceFor([searchByDate]);

    const result = await source.search(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/linkedin/post-search");
    expect(calls[0]?.key).toBe("a-harvestapi-key");
    expect(calls[0]?.url.searchParams.get("search")).toBe("flaky tests");
    expect(calls[0]?.url.searchParams.get("sortBy")).toBe("date");
    expect(calls[0]?.url.searchParams.has("postedLimit")).toBe(false);

    expect(result.posts).toHaveLength(50);
    expect(result.unitsConsumed).toBe(1);
    expect(result.next).toEqual({ status: "done" });
    expect(result.foundBy).toEqual({ kind: "query", value: "flaky tests" });
  });

  it("stores the activity id, the post's own URL and its exact date", async () => {
    const { source } = sourceFor([searchByDate]);

    const [first] = (await source.search(request())).posts;

    expect(first?.externalId).toBe(firstPostId);
    expect(first?.url).toBe(firstPostUrl);
    expect(first?.postedAt).toEqual(firstPostAt);
    expect(first?.text.startsWith("One thing I really like about Playwright")).toBe(true);
    expect(first?.author).toBe("li-user-2");
  });

  it("charges a request for a search that finds nothing", async () => {
    const { source } = sourceFor([noResults]);

    const result = await source.search(request());

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(1);
  });

  it("walks the monitor's queries one request at a time", async () => {
    const { source, calls } = sourceFor([searchByDate]);
    const two = request({ query: { queries: ["flaky tests", "brittle e2e"], channels: [] } });

    const first = await source.search(two);
    expect(first.next).toEqual({ status: "ready", cursor: "1" });

    const second = await source.search({ ...two, cursor: "1" });
    expect(second.next).toEqual({ status: "done" });
    expect(calls.map((call) => call.url.searchParams.get("search"))).toEqual([
      "flaky tests",
      "brittle e2e",
    ]);
  });

  it("finishes without a request when a cursor is past the monitor's queries", async () => {
    const { source, calls } = sourceFor([searchByDate]);

    const result = await source.search(request({ cursor: "3" }));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
    expect(calls).toHaveLength(0);
  });

  it("refuses a cursor it did not issue", async () => {
    const { source } = sourceFor([searchByDate]);

    await expect(source.search(request({ cursor: "abc" }))).rejects.toThrow(/was not issued/);
  });

  it("sends the narrowest LinkedIn window that covers `since`, and none past a month", async () => {
    const windows: (string | null)[] = [];

    for (const since of [
      hoursBefore(2),
      hoursBefore(72),
      hoursBefore(24 * 20),
      hoursBefore(24 * 40),
    ]) {
      const { source, calls } = sourceFor([searchByDate]);
      await source.search(request({ query: { queries: ["flaky tests"], channels: [], since } }));
      windows.push(calls[0]?.url.searchParams.get("postedLimit") ?? null);
    }

    expect(windows).toEqual(["24h", "week", "month", null]);
  });

  it("cuts the page at `since` exactly, and still charges the request", async () => {
    const { source } = sourceFor([searchByDate]);
    const since = new Date("2026-09-23T20:00:00.000Z");

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since } }),
    );

    expect(result.posts).toHaveLength(10);
    expect(result.posts.every((post) => post.postedAt > since)).toBe(true);
    expect(result.unitsConsumed).toBe(1);
  });

  it("hands back no more than the caller's limit", async () => {
    const { source } = sourceFor([searchByDate]);

    expect((await source.search(request({ limit: 5 }))).posts).toHaveLength(5);
  });

  it("names the key as the problem when the provider refuses it", async () => {
    const { source } = sourceFor([credentialsRejected]);

    const failure = await source.search(request()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HarvestApiError);
    expect((failure as HarvestApiError).kind).toBe("credentials");
    expect((failure as HarvestApiError).message).toContain("Invalid API key");
  });

  it("hands a refusal for load back as a wait on the same query", async () => {
    // Never measured: no capture was refused for load. This is our half.
    const { source } = sourceFor([{ httpStatus: 429, body: {} }]);

    const result = await source.search(request());

    expect(result.unitsConsumed).toBe(0);
    expect(result.next.status).toBe("wait");
    expect(result.next.status === "wait" && result.next.cursor).toBe("0");
  });
});

describe("validateCredentials", () => {
  it("reads the free account endpoint and reports a refused key as invalid", async () => {
    const { source, calls } = sourceFor([probeRejected]);

    const check = await source.validateCredentials(credentials);

    expect(calls[0]?.url.pathname).toBe("/users/my-api-user");
    expect(check.valid).toBe(false);
  });

  it("accepts a key the account endpoint answers", async () => {
    // The probe reads the status alone, so the body is not parsed; the account
    // answer names its holder and is deliberately not a fixture.
    const { source } = sourceFor([{ httpStatus: 200, body: {} }]);

    expect(await source.validateCredentials(credentials)).toEqual({ valid: true });
  });

  it("asks for a key before calling anyone", async () => {
    const { source, calls } = sourceFor([probeRejected]);

    expect((await source.validateCredentials({})).valid).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("fetchReplies", () => {
  function replies(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
    return {
      postUrl: "https://www.linkedin.com/posts/activity-7508514943374266368-abcd",
      postExternalId: commentedPostId,
      credentials,
      ...overrides,
    };
  }

  it("reads one page of comments by date, for one request", async () => {
    const { source, calls } = sourceFor([comments]);

    const result = await source.fetchReplies(replies());

    expect(calls[0]?.url.pathname).toBe("/linkedin/post-comments");
    expect(calls[0]?.url.searchParams.get("sortBy")).toBe("date");
    expect(result.replies).toHaveLength(4);
    expect(result.itemsReturned).toBe(4);
    expect(result.unitsConsumed).toBe(1);
    expect(result.next).toEqual({ status: "done" });
    expect(result.partial).toBe(false);
  });

  it("keeps each comment's id, its link and the post it answers", async () => {
    const { source } = sourceFor([comments]);

    const [first] = (await source.fetchReplies(replies())).replies;

    expect(first?.externalId).toBe("7508631515715510272");
    expect(first?.postedAt).toEqual(new Date("2026-09-23T21:00:56.975Z"));
    expect(first?.parentPostExternalId).toBe(commentedPostId);
    expect(first?.url).toContain("commentUrn=");
  });

  it("drops comments that say they belong to another post", async () => {
    const { source } = sourceFor([comments]);

    const result = await source.fetchReplies(replies({ postExternalId: "1" }));

    expect(result.replies).toEqual([]);
    expect(result.itemsReturned).toBe(4);
  });

  it("cuts at `since`", async () => {
    const { source } = sourceFor([comments]);

    const result = await source.fetchReplies(
      replies({ since: new Date("2026-09-23T20:00:00.000Z") }),
    );

    expect(result.replies.map((reply) => reply.externalId)).toEqual(["7508631515715510272"]);
  });
});
