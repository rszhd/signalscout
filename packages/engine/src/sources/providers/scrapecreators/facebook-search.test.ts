/**
 * The Facebook connector's phrase search and full read (US-557), driven
 * against payloads captured from the live provider under
 * `facebook-fixtures/` by `capture-search.mjs`.
 *
 * Nothing here reaches the network. docs/testing.md, *No test spends money*.
 * No fixture file is edited and no payload is written by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { searchQuerySchemaFor } from "../../../ai/queries.js";
import type { Logger } from "../../../logger.js";
import { facebookPlatform } from "../../platforms.js";
import type { CandidatePost, CompleteResult, SearchRequest, SourceRuntime } from "../../types.js";
import {
  ageOf,
  createScrapeCreatorsFacebook,
  groupPostOf,
  isGroupAddress,
  ScrapeCreatorsFacebookSource,
  windowFor,
} from "./facebook.js";

interface Captured {
  readonly status: number;
  readonly body: unknown;
}

interface SearchResultRecord {
  readonly url: string;
  readonly title: string;
  readonly description: string;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./facebook-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const pageOne = fixture("search-page-1");
const pageTwo = fixture("search-page-2");
const nothing = fixture("search-nothing");
const postRead = fixture("post-read");
const postMissing = fixture("post-missing");
const groupPage = fixture("group-page-1");

function resultsOf(captured: Captured): readonly SearchResultRecord[] {
  return (captured.body as { results?: readonly SearchResultRecord[] }).results ?? [];
}

function provider(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: URL[] = [];

  const fetchStub: typeof globalThis.fetch = (input) => {
    calls.push(new URL(String(input)));
    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };

  return { fetch: fetchStub, calls };
}

/** The moment of the capture, so the ages in the snippets read as captured. */
const now = new Date("2026-11-10T05:40:43.000Z");
const hourAgo = new Date(now.getTime() - 3_600_000);

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: { warn: () => undefined } as unknown as Logger,
  };
}

const credentials = { apiKey: "a-scrapecreators-key" };
const phrase = "3d printer recommend";
const groupAddress = "https://www.facebook.com/groups/856491544939621/";

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: [phrase], channels: [], since: hourAgo },
    credentials,
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<CompleteResult>): Promise<CompleteResult[]> {
  const out: CompleteResult[] = [];
  for await (const result of stream) out.push(result);
  return out;
}

describe("searching a phrase", () => {
  it("asks Google for the phrase within public groups over the past day", async () => {
    const { fetch, calls } = provider([pageOne]);
    await new ScrapeCreatorsFacebookSource(runtimeWith(fetch)).search(request());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe("/v1/google/search");
    expect(calls[0]?.searchParams.get("query")).toBe(`${phrase} site:facebook.com/groups`);
    expect(calls[0]?.searchParams.get("date_posted")).toBe("last-day");
    expect(calls[0]?.searchParams.has("page")).toBe(false);
  });

  it("turns every result into a partial post with an approximate date", async () => {
    const { fetch } = provider([pageOne]);
    const result = await new ScrapeCreatorsFacebookSource(runtimeWith(fetch)).search(request());
    const records = resultsOf(pageOne);

    expect(result.posts).toHaveLength(records.length);
    expect(result.unitsConsumed).toBe(1);
    expect(result.foundBy).toEqual({ kind: "query", value: phrase });

    const first = result.posts[0] as CandidatePost;
    const where = groupPostOf(records[0]?.url ?? "");
    expect(first.externalId).toBe(where?.id);
    expect(first.channel).toBe(where?.group);
    expect(first.url).toBe(`https://www.facebook.com/groups/${where?.group}/posts/${where?.id}/`);
    expect(first.postedAtIsApproximate).toBe(true);
    expect(first.partial).toEqual({});
    expect(first.title).not.toMatch(/ - Facebook$/);
    // "9 hours ago" in the captured snippet.
    expect(first.postedAt.getTime()).toBe(now.getTime() - 9 * 3_600_000);
  });

  it("keeps a post Google dates before since, because Google shows posts late", async () => {
    const { fetch } = provider([pageOne]);
    const result = await new ScrapeCreatorsFacebookSource(runtimeWith(fetch)).search(request());

    expect(result.posts.some((post) => post.postedAt < hourAgo)).toBe(true);
    expect(result.posts).toHaveLength(resultsOf(pageOne).length);
  });

  it("reads the default two pages, repeats no post, then moves on", async () => {
    const { fetch, calls } = provider([pageOne, pageTwo]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(fetch));

    const first = await source.search(request());
    expect(first.next.status).toBe("ready");
    const cursor = first.next.status === "ready" ? first.next.cursor : undefined;

    const second = await source.search(request({ cursor }));
    expect(calls[1]?.searchParams.get("page")).toBe("2");
    expect(second.next).toEqual({ status: "done" });

    const ids = [...first.posts, ...second.posts].map((post) => post.externalId);
    const unique = new Set(
      [...resultsOf(pageOne), ...resultsOf(pageTwo)].map((record) => groupPostOf(record.url)?.id),
    );
    expect(ids).toHaveLength(unique.size);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads one page when the application asks for one, and never past page 11", async () => {
    const one = provider([pageOne]);
    const single = await new ScrapeCreatorsFacebookSource(runtimeWith(one.fetch)).search(
      request({ pagesPerInput: 1 }),
    );
    expect(single.next).toEqual({ status: "done" });

    const many = provider([pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(many.fetch));
    let next = (await source.search(request({ pagesPerInput: 20 }))).next;
    let pages = 1;
    while (next.status === "ready") {
      next = (await source.search(request({ pagesPerInput: 20, cursor: next.cursor }))).next;
      pages += 1;
    }
    expect(pages).toBe(11);
  });

  it("pays nothing for a search that finds nothing, and moves on", async () => {
    const { fetch } = provider([nothing]);
    const result = await new ScrapeCreatorsFacebookSource(runtimeWith(fetch)).search(request());

    expect(result.posts).toEqual([]);
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({ status: "done" });
  });

  it("walks a phrase and a group address in one monitor, each its own way", async () => {
    const { fetch, calls } = provider([pageOne, groupPage]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(fetch));
    const both = request({
      pagesPerInput: 1,
      query: { queries: [phrase, groupAddress], channels: [], since: new Date(0) },
    });

    const first = await source.search(both);
    const cursor = first.next.status === "ready" ? first.next.cursor : undefined;
    const second = await source.search({ ...both, cursor });

    expect(calls[0]?.pathname).toBe("/v1/google/search");
    expect(calls[1]?.pathname).toBe("/v1/facebook/group/posts");
    expect(second.foundBy).toEqual({ kind: "channel", value: groupAddress });
  });
});

describe("reading a found post whole", () => {
  const source = (replies: readonly Captured[]) =>
    new ScrapeCreatorsFacebookSource(runtimeWith(provider(replies).fetch));
  const record = postRead.body as { url: string; post_id: string; creation_time: string };

  it("gives the post's own text and exact date, under the id the search gave", async () => {
    const [result] = await collect(
      source([postRead]).completePosts({ posts: [{ url: record.url }], credentials }),
    );

    expect(result?.status).toBe("complete");
    if (result?.status !== "complete") return;
    expect(result.unitsConsumed).toBe(1);
    expect(result.post.externalId).toBe(groupPostOf(record.url)?.id);
    expect(result.post.externalId).toBe(record.post_id);
    expect(result.post.postedAt.toISOString()).toBe(new Date(record.creation_time).toISOString());
    expect(result.post.postedAtIsApproximate).toBeUndefined();
    expect(result.post.partial).toBeUndefined();
    expect(result.post.text.length).toBeGreaterThan(0);
  });

  it("keeps the partial text of a post that is gone, and pays nothing", async () => {
    const [result] = await collect(
      source([postMissing]).completePosts({
        posts: [{ url: "https://www.facebook.com/groups/856491544939621/posts/1/" }],
        credentials,
      }),
    );

    expect(result).toMatchObject({ status: "unread", unitsConsumed: 0 });
  });

  it("throws on a refused key", async () => {
    const refused = { status: 401, body: { message: "Invalid API key" } };
    await expect(
      collect(source([refused]).completePosts({ posts: [{ url: record.url }], credentials })),
    ).rejects.toThrow(/rejected the API key/);
  });
});

describe("telling a phrase from a group, and reading a snippet's age", () => {
  it("reads a group's address as a group and anything else as a phrase", () => {
    expect(isGroupAddress(groupAddress)).toBe(true);
    expect(isGroupAddress("https://www.facebook.com/groups/hibrew/")).toBe(true);
    expect(isGroupAddress("camping fridge")).toBe(false);
    expect(isGroupAddress("groups for camping")).toBe(false);
  });

  it("picks the smallest window that covers since", () => {
    expect(windowFor(hourAgo, now)).toBe("last-day");
    expect(windowFor(new Date(now.getTime() - 3 * 86_400_000), now)).toBe("last-week");
    expect(windowFor(new Date(now.getTime() - 30 * 86_400_000), now)).toBe("last-month");
    expect(windowFor(undefined, now)).toBe("last-week");
  });

  it("reads a relative age and a date, and nothing else", () => {
    expect(ageOf("1 day ago ... text", now)?.postedAt.getTime()).toBe(now.getTime() - 86_400_000);
    expect(ageOf("Nov 5, 2026 ... text", now)?.postedAt.toISOString()).toBe(
      "2026-11-05T00:00:00.000Z",
    );
    expect(ageOf("5 hours ago ... the words", now)?.rest).toBe("the words");
    expect(ageOf("Best fridge 5 hours ago", now)).toBeUndefined();
  });

  it("finds a group post in any of Facebook's address forms", () => {
    expect(groupPostOf("https://web.facebook.com/groups/abc/permalink/123/")).toEqual({
      group: "abc",
      id: "123",
    });
    expect(groupPostOf("https://www.facebook.com/abc/posts/pfbid02x")).toBeUndefined();
  });
});

describe("what a person may write as a Facebook query", () => {
  const schema = searchQuerySchemaFor(facebookPlatform.search);

  it("accepts a group's address and a short phrase", () => {
    expect(schema.safeParse(groupAddress).success).toBe(true);
    expect(schema.safeParse("camping fridge").success).toBe(true);
  });

  it("refuses an address that is not a group, and a long phrase", () => {
    expect(schema.safeParse("https://www.facebook.com/somepage/").success).toBe(false);
    expect(schema.safeParse("one two three four five six seven").success).toBe(false);
  });
});

describe("the connector's page caps", () => {
  it("declares the larger of its group cap and its phrase cap", () => {
    expect(createScrapeCreatorsFacebook().maxUnitsPerQueryPoll).toBe(5);
    expect(createScrapeCreatorsFacebook({ pagesPerGroup: 1 }).maxUnitsPerQueryPoll).toBe(2);
  });
});
