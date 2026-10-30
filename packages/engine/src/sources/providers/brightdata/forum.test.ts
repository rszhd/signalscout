import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import type { SearchRequest, SearchResult, SourceRuntime } from "../../types.js";
import {
  BrightDataForumSource,
  createBrightDataForum,
  maxThreadsPerSection,
  threadsPerCall,
  worthOpening,
} from "./forum.js";

const fixtures = new URL("../../forums/fixtures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtures), "utf8")) as Record<
  string,
  { url: string; capturedAt: string }
>;
const captured = (file: string) => readFileSync(new URL(file, fixtures), "utf8");

const credentials = { apiKey: "bd-key", unlockerZone: "web_unlocker1" };
const xenforoList = manifest["xenforo2-list.html"]?.url ?? "";

interface Asked {
  readonly url: string;
  readonly zone: string;
}

/**
 * A Bright Data that answers from captured pages: `pages` maps a target
 * address to a body, `threads` answers every other address.
 */
function brightData(
  pages: Record<string, string | { status: number; body: string }>,
  threads?: string,
) {
  const asked: Asked[] = [];
  const fetch: typeof globalThis.fetch = async (_endpoint, init) => {
    const { url, zone } = JSON.parse(String(init?.body)) as Asked;
    asked.push({ url, zone });
    const answer = pages[url] ?? threads;
    if (answer === undefined) return new Response("not captured", { status: 500 });
    return typeof answer === "string"
      ? new Response(answer, { status: 200 })
      : new Response(answer.body, { status: answer.status, headers: { "retry-after": "30" } });
  };
  return { fetch, asked };
}

function runtimeWith(
  fetch: typeof globalThis.fetch,
  now = "2026-10-30T07:00:00.000Z",
): SourceRuntime {
  return {
    fetch,
    now: () => new Date(now),
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "forum-test" }),
  };
}

function request(queries: string[], since?: string, cursor?: string): SearchRequest {
  return {
    query: { queries, channels: [], ...(since ? { since: new Date(since) } : {}) },
    credentials,
    ...(cursor ? { cursor } : {}),
  };
}

/** Every call of one walk, following the cursor. */
async function walk(
  source: BrightDataForumSource,
  queries: string[],
  since?: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let cursor: string | undefined;
  for (let call = 0; call < 50; call += 1) {
    const result = await source.search(request(queries, since, cursor));
    results.push(result);
    if (result.next.status !== "ready") break;
    cursor = result.next.cursor;
  }
  return results;
}

describe("reading a forum section", () => {
  it("reads the list, then opens only the threads started since the last read", async () => {
    const stub = brightData(
      { [xenforoList]: captured("xenforo2-list.html") },
      captured("xenforo2-thread.html"),
    );
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    // Just before the newest thread that is not pinned, M6 iMac.
    const results = await walk(source, [xenforoList], "2026-10-28T18:00:00.000Z");

    expect(stub.asked.map((call) => call.url)).toEqual([
      xenforoList,
      "https://forums.macrumors.com/threads/m6-imac.2493064/",
    ]);
    expect(stub.asked.every((call) => call.zone === "web_unlocker1")).toBe(true);
    const posts = results.flatMap((result) => result.posts);
    expect(posts).toEqual([
      {
        // A thread id is only unique inside its forum.
        externalId: "forums.macrumors.com:2493064",
        url: "https://forums.macrumors.com/threads/m6-imac.2493064/",
        channel: "forums.macrumors.com",
        title: "M6 iMac",
        text: expect.stringContaining("I ordered my M6 iMac this morning"),
        postedAt: new Date("2026-10-28T18:05:14.000Z"),
      },
    ]);
    expect(results.map((result) => result.unitsConsumed)).toEqual([1, 1]);
    expect(results.every((result) => result.foundBy?.value === xenforoList)).toBe(true);
  });

  it("never opens a pinned thread, and stops at the per-section cap", async () => {
    const stub = brightData(
      { [xenforoList]: captured("xenforo2-list.html") },
      captured("xenforo2-thread.html"),
    );
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const results = await walk(source, [xenforoList]);

    const opened = stub.asked.slice(1).map((call) => call.url);
    expect(opened).toHaveLength(maxThreadsPerSection);
    // The list's four pinned threads are its first four rows.
    expect(opened.some((url) => url.includes("starstarstarinformation"))).toBe(false);
    // A list call, then the threads a few at a time.
    expect(results).toHaveLength(1 + Math.ceil(maxThreadsPerSection / threadsPerCall));
    expect(results.reduce((sum, result) => sum + result.unitsConsumed, 0)).toBe(
      1 + maxThreadsPerSection,
    );
  });

  it("opens a thread whose list shows no start, and passes on a date read from words", async () => {
    const smfList = manifest["smf2-list.html"]?.url ?? "";
    const stub = brightData(
      { [smfList]: captured("smf2-list.html") },
      captured("smf2-thread.html"),
    );
    const source = new BrightDataForumSource(runtimeWith(stub.fetch, "2026-03-16T20:00:00.000Z"));

    // SMF lists no start: a thread active since is opened, and its own page
    // decides. The captured thread started on 2026-02-25.
    const results = await walk(source, [smfList], "2026-02-24T00:00:00.000Z");

    const posts = results.flatMap((result) => result.posts);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]).toMatchObject({
      externalId: "geekhack.org:126408",
      postedAt: new Date("2026-02-25T12:03:37.000Z"),
      postedAtIsApproximate: true,
    });
  });

  it("reads a Discourse section through its JSON, and each topic's JSON", async () => {
    const list = manifest["discourse-list.json"]?.url ?? "";
    const stub = brightData(
      { [list]: captured("discourse-list.json") },
      captured("discourse-thread.json"),
    );
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const results = await walk(source, [list], "2026-10-30T03:00:00.000Z");

    expect(stub.asked[1]?.url).toBe("https://meta.discourse.org/t/416139.json");
    expect(results.flatMap((result) => result.posts)[0]).toMatchObject({
      externalId: "meta.discourse.org:416139",
      url: "https://meta.discourse.org/t/topic/416139",
    });
  });
});

describe("an application's own limit", () => {
  it("opens no more threads a section than the application allows, and prices its cap so", async () => {
    const stub = brightData(
      { [xenforoList]: captured("xenforo2-list.html") },
      captured("xenforo2-thread.html"),
    );
    const connector = createBrightDataForum({ threadsPerSection: 3 });
    const source = connector.create(runtimeWith(stub.fetch)) as BrightDataForumSource;

    await walk(source, [xenforoList]);

    expect(stub.asked).toHaveLength(1 + 3);
    expect(connector.maxUnitsPerQueryPoll).toBe(4);
    expect(() => createBrightDataForum({ threadsPerSection: 0 })).toThrow(RangeError);
  });
});

describe("what is skipped, and what it costs", () => {
  it("skips a section Bright Data does not pass, and bills nothing for it", async () => {
    const refused = "Residential Failed (bad_endpoint): Requested site is not available";
    const stub = brightData({
      "https://a.example/forum": refused,
      [xenforoList]: captured("xenforo2-list.html"),
    });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const first = await source.search(
      request(["https://a.example/forum", xenforoList], "2026-10-30T06:00:00.000Z"),
    );

    expect(first.posts).toEqual([]);
    expect(first.unitsConsumed).toBe(0);
    // On to the next section, not the end.
    expect(first.next.status).toBe("ready");
  });

  it("skips a page no parser knows, and bills the request it was", async () => {
    const stub = brightData({ "https://a.example/forum": "<html><body>Hello</body></html>" });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const result = await source.search(request(["https://a.example/forum"]));

    expect(result).toEqual({
      posts: [],
      foundBy: { kind: "query", value: "https://a.example/forum" },
      unitsConsumed: 1,
      next: { status: "done" },
    });
  });

  it("waits when Bright Data asks it to, keeping its place", async () => {
    const stub = brightData({ [xenforoList]: { status: 429, body: "slow down" } });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const result = await source.search(request([xenforoList]));

    expect(result.next).toEqual({
      status: "wait",
      retryAfter: new Date("2026-10-30T07:00:30.000Z"),
    });
    expect(result.unitsConsumed).toBe(0);
  });

  it("refuses a missing zone without asking Bright Data", async () => {
    const stub = brightData({});
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    expect(await source.validateCredentials({ apiKey: "bd-key" })).toEqual({
      valid: false,
      reason: "Enter the name of your Web Unlocker zone.",
    });
    expect(stub.asked).toHaveLength(0);
  });
});

describe("which threads are new", () => {
  const since = new Date("2026-10-30T00:00:00.000Z");
  const thread = { id: "1", url: "https://f.example/t/1", title: "t", pinned: false };

  it("trusts an exact start, and gives a start in words a day's margin", () => {
    expect(
      worthOpening(
        {
          ...thread,
          startedAt: new Date("2026-10-29T23:00:00Z"),
          approximateStart: false,
          lastActivityAt: null,
        },
        since,
      ),
    ).toBe(false);
    expect(
      worthOpening(
        {
          ...thread,
          startedAt: new Date("2026-10-29T23:00:00Z"),
          approximateStart: true,
          lastActivityAt: null,
        },
        since,
      ),
    ).toBe(true);
  });

  it("opens a thread with no start when it has been active since", () => {
    expect(
      worthOpening(
        {
          ...thread,
          startedAt: null,
          approximateStart: false,
          lastActivityAt: new Date("2026-10-30T01:00:00Z"),
        },
        since,
      ),
    ).toBe(true);
    expect(
      worthOpening(
        {
          ...thread,
          startedAt: null,
          approximateStart: false,
          lastActivityAt: new Date("2026-10-20T01:00:00Z"),
        },
        since,
      ),
    ).toBe(false);
  });

  it("never opens a pinned one", () => {
    expect(
      worthOpening(
        {
          ...thread,
          pinned: true,
          startedAt: new Date("2026-10-30T05:00:00Z"),
          approximateStart: false,
          lastActivityAt: null,
        },
        since,
      ),
    ).toBe(false);
  });
});
