/**
 * The ScrapeCreators Facebook group connector, driven against payloads captured
 * from the live provider under `facebook-fixtures/`.
 *
 * Nothing here reaches the network. docs/testing.md, *No test spends money*.
 *
 * The tests read each fixture as it was captured and clone one in memory where
 * a case needs a missing piece. No fixture file is edited and no payload is
 * written by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../../logger.js";
import { facebookPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import {
  createScrapeCreatorsFacebook,
  ScrapeCreatorsFacebookSource,
  scrapeCreatorsFacebook,
} from "./facebook.js";
import { scrapeCreatorsProviderId } from "./provider.js";

interface Captured {
  readonly status: number;
  readonly body: unknown;
}

interface PostRecord {
  readonly id: string;
  readonly url: string;
  readonly text: string | null;
  readonly publishTime: number;
  readonly author?: { readonly name?: string };
  readonly commentCount?: number;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./facebook-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const pageOne = fixture("group-page-1");
const pageTwo = fixture("group-page-2");

const groupAddress = "https://www.facebook.com/groups/856491544939621/";

function postsOf(captured: Captured): readonly PostRecord[] {
  return (captured.body as { posts?: readonly PostRecord[] }).posts ?? [];
}

function cursorOf(captured: Captured): string | undefined {
  const cursor = (captured.body as { cursor?: unknown }).cursor;
  return typeof cursor === "string" ? cursor : undefined;
}

function provider(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: { url: string }[] = [];

  const fetchStub: typeof globalThis.fetch = (input) => {
    calls.push({ url: String(input) });
    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;

    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };

  return { fetch: fetchStub, calls };
}

/** The day after the capture, so the fixtures sit inside a short window. */
const now = new Date("2026-11-04T12:00:00.000Z");

function runtimeWith(fetchStub: typeof globalThis.fetch, warnings: string[] = []): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: {
      warn: (context: unknown, message: unknown) => {
        const line = [context, message]
          .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
          .join(" ");
        warnings.push(line);
      },
    } as unknown as Logger,
  };
}

const credentials = { apiKey: "a-scrapecreators-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: [groupAddress], channels: [] }, credentials, ...overrides };
}

describe("the connector's declared economics", () => {
  it("is Facebook groups fetched by ScrapeCreators", () => {
    expect(scrapeCreatorsFacebook.platform.id).toBe(facebookPlatformId);
    expect(scrapeCreatorsFacebook.provider.id).toBe(scrapeCreatorsProviderId);
    assertSourcesCanBeStored([scrapeCreatorsFacebook.platform.id]);
  });

  it("bills a request at the provider's credit price and reads three posts a unit", () => {
    expect(scrapeCreatorsFacebook.billableUnit).toBe("request");
    expect(scrapeCreatorsFacebook.pricePerUnitMicros).toBe(1880);
    expect(scrapeCreatorsFacebook.postsPerUnit).toBe(3);
    expect(scrapeCreatorsFacebook.discovery).toEqual(["channel"]);
    expect(scrapeCreatorsFacebook.linksToComments).toBe(false);
    expect(scrapeCreatorsFacebook.canFetchReplies).toBe(false);
    expect(scrapeCreatorsFacebook.maxUnitsPerQueryPoll).toBe(5);
  });

  it("lets an application set a lower page cap", () => {
    const lower = createScrapeCreatorsFacebook({ pagesPerGroup: 1 });

    expect(lower.maxUnitsPerQueryPoll).toBe(1);
    expect(() => createScrapeCreatorsFacebook({ pagesPerGroup: 6 })).toThrow(RangeError);
  });
});

describe("reading a captured group page", () => {
  it("turns the page into posts with the group as their channel", async () => {
    const records = postsOf(pageOne);
    const stub = provider([pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(4);
    expect(result.unitsConsumed).toBe(1);
    expect(result.foundBy).toEqual({ kind: "channel", value: groupAddress });

    const first = result.posts[0];
    const record = records[0] as PostRecord;

    expect(first?.externalId).toBe(record.id);
    expect(first?.url).toBe(record.url);
    expect(first?.text).toBe(record.text);
    expect(first?.postedAt.getTime()).toBe(record.publishTime * 1000);
    expect(first?.author).toBe(record.author?.name);
    expect(first?.channel).toBe("856491544939621");
    expect(first?.replyCount).toBe(record.commentCount);
  });

  it("keeps only posts newer than since", async () => {
    const records = postsOf(pageOne);
    const since = new Date((records[2]?.publishTime ?? 0) * 1000);
    const stub = provider([pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: [groupAddress], channels: [], since } }),
    );

    const expected = records
      .filter((record) => record.publishTime > since.getTime() / 1000)
      .map((record) => record.id);

    expect(result.posts.map((post) => post.externalId)).toEqual(expected);
  });

  it("skips a post with no text, such as a photo only", async () => {
    const body = pageOne.body as { posts: readonly Record<string, unknown>[] };
    const silent: Captured = {
      status: pageOne.status,
      body: {
        ...body,
        posts: body.posts.map((post, index) => (index === 0 ? { ...post, text: null } : post)),
      },
    };

    const stub = provider([silent]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(body.posts.length - 1);
    expect(result.posts.map((post) => post.externalId)).not.toContain(body.posts[0]?.id);
  });
});

describe("paging a group", () => {
  it("follows the cursor and repeats no post", async () => {
    const stub = provider([pageOne, pageTwo]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    expect(one.next.status).toBe("ready");
    if (one.next.status !== "ready") return;

    const two = await source.search(request({ cursor: one.next.cursor }));

    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("cursor")).toBe(cursorOf(pageOne));

    const ids = [...one.posts, ...two.posts].map((post) => post.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns a post id that appears on two pages of one group once", async () => {
    const first = postsOf(pageOne)[0] as PostRecord;
    const secondBody = pageTwo.body as { posts: readonly unknown[] };
    const repeated: Captured = {
      status: pageTwo.status,
      body: { ...secondBody, posts: [first, ...secondBody.posts] },
    };

    const stub = provider([pageOne, repeated]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    expect(one.next.status).toBe("ready");
    if (one.next.status !== "ready") return;

    const two = await source.search(request({ cursor: one.next.cursor }));
    const ids = [...one.posts, ...two.posts].map((post) => post.externalId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(two.posts.map((post) => post.externalId)).not.toContain(first.id);
  });

  it("does not stop on an older top post", async () => {
    const top = fixture("group-top-post");
    const records = postsOf(top);
    const older = records[1] as PostRecord;
    const since = new Date((older.publishTime + 1) * 1000);
    const topAddress = "https://www.facebook.com/groups/ninjaespressoenthusiasts/";

    const stub = provider([top, pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const query = { queries: [topAddress], channels: [], since };
    const one = await source.search(request({ query }));

    expect(one.posts).toHaveLength(records.length - 1);
    expect(one.posts.map((post) => post.externalId)).not.toContain(older.id);
    expect(one.next.status).toBe("ready");
    if (one.next.status !== "ready") return;

    await source.search(request({ query, cursor: one.next.cursor }));

    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("cursor")).toBe(cursorOf(top));
  });

  it("moves to the next group when every post is older than since", async () => {
    const since = new Date("2026-11-04T12:00:00.000Z");
    const other = "https://www.facebook.com/groups/111111111111111/";
    const stub = provider([pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));
    const query = { queries: [other, groupAddress], channels: [], since };

    const result = await source.search(request({ query }));

    expect(result.posts).toHaveLength(0);
    expect(result.next.status).toBe("ready");
    if (result.next.status !== "ready") return;

    await source.search(request({ query, cursor: result.next.cursor }));

    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("url")).toBe(groupAddress);
  });

  it("stops one group at the default five pages", async () => {
    const stub = provider([pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const result = await source.search(request(cursor ? { cursor } : {}));
      pages += 1;

      if (result.next.status === "done") break;
      expect(result.next.status).toBe("ready");
      if (result.next.status !== "ready") return;
      cursor = result.next.cursor;
    }

    expect(pages).toBe(5);
  });

  it("stops after one page when the application asks for one", async () => {
    const stub = provider([pageOne]);
    const definition = createScrapeCreatorsFacebook({ pagesPerGroup: 1 });
    const source = definition.create(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.next.status).toBe("done");
    expect(stub.calls).toHaveLength(1);
  });
});

describe("a group that cannot be read", () => {
  it("skips a missing group, logs its address, and reads the next group", async () => {
    const warnings: string[] = [];
    const missingAddress = "https://www.facebook.com/groups/intentwatch-no-such-group-zqxjkv/";
    const stub = provider([fixture("group-missing"), pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch, warnings));
    const query = { queries: [missingAddress, groupAddress], channels: [] };

    const first = await source.search(request({ query }));

    expect(first.posts).toHaveLength(0);
    expect(first.unitsConsumed).toBe(0);
    expect(warnings.join(" ")).toContain(missingAddress);
    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    const second = await source.search(request({ query, cursor: first.next.cursor }));

    expect(second.posts).toHaveLength(4);
  });

  it("reads an empty page, pays its credit, and moves to the next group", async () => {
    const privateAddress = "https://www.facebook.com/groups/baristahustle/";
    const stub = provider([fixture("group-maybe-private"), pageOne]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));
    const query = { queries: [privateAddress, groupAddress], channels: [] };

    const first = await source.search(request({ query }));

    expect(first.posts).toHaveLength(0);
    expect(first.unitsConsumed).toBe(1);
    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    const second = await source.search(request({ query, cursor: first.next.cursor }));

    expect(second.posts).toHaveLength(4);
  });
});

describe("credentials", () => {
  it("reads the provider's own refusal back to the person", async () => {
    const stub = provider([fixture("credentials-rejected")]);
    const source = new ScrapeCreatorsFacebookSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
    if (check.valid) return;
    expect(check.reason).toContain("ScrapeCreators rejected the API key");
  });
});
