import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { readFeed } from "../../forums/index.js";
import type {
  CompleteRequest,
  CompleteResult,
  SearchRequest,
  SearchResult,
  SourceRuntime,
} from "../../types.js";
import type { OpenPageBrowser } from "../browseruse/pages.js";
import {
  BrightDataForumSource,
  createBrightDataForum,
  type ForumPageEvent,
  maxStreamPagesPerPoll,
  maxThreadsPerSection,
  openForumFetcher,
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

describe("reading a forum's newest-threads feed", () => {
  const mybbFeed = manifest["mybb-feed.xml"]?.url ?? "";
  const xenforoFeed = manifest["xenforo2-feed.xml"]?.url ?? "";

  it("takes a feed's full posts as they are, in one request", async () => {
    const stub = brightData({ [mybbFeed]: captured("mybb-feed.xml") });
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      onPage: (event) => events.push(event),
    });

    // Between the newest two threads.
    const results = await walk(source, [mybbFeed], "2026-10-30T17:50:00.000Z");

    expect(stub.asked.map((call) => call.url)).toEqual([mybbFeed]);
    expect(results.flatMap((result) => result.posts)).toEqual([
      {
        externalId: "forum.kodi.tv:389557",
        url: "https://forum.kodi.tv/showthread.php?tid=389557",
        channel: "forum.kodi.tv",
        title: expect.stringContaining("ExtraFanart Filler"),
        text: expect.stringContaining("I created a Kodi addon"),
        postedAt: new Date("2026-10-30T18:08:10.000Z"),
      },
    ]);
    expect(results.map((result) => result.unitsConsumed)).toEqual([1]);
    expect(events).toEqual([
      {
        host: "forum.kodi.tv",
        url: mybbFeed,
        page: "feed",
        via: "unlocker",
        units: 1,
        outcome: "read",
        program: "mybb",
        threads: 0,
        posts: 1,
      },
    ]);
  });

  it("takes a feed no program claims as its posts, and opens no page", async () => {
    const feed = manifest["nofeedparser-mumsnet-feed.xml"]?.url ?? "";
    const stub = brightData({ [feed]: captured("nofeedparser-mumsnet-feed.xml") });
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      onPage: (event) => events.push(event),
    });

    const posts = (await walk(source, [feed])).flatMap((result) => result.posts);
    const items = readFeed(captured("nofeedparser-mumsnet-feed.xml"), feed) ?? [];

    expect(stub.asked.map((call) => call.url)).toEqual([feed]);
    expect(posts).toHaveLength(items.length);
    for (const post of posts) {
      expect(post.externalId.startsWith("www.mumsnet.com:/talk/")).toBe(true);
      expect(post.partial).toBeUndefined();
    }
    expect(events).toEqual([
      {
        host: "www.mumsnet.com",
        url: feed,
        page: "feed",
        via: "unlocker",
        units: 1,
        outcome: "read",
        program: null,
        threads: 0,
        posts: posts.length,
      },
    ]);
  });

  it("drops a feed's items older than the poll's window, where no program claims it", async () => {
    const feed = manifest["nofeedparser-vanilla-feed.xml"]?.url ?? "";
    const stub = brightData({ [feed]: captured("nofeedparser-vanilla-feed.xml") });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const items = readFeed(captured("nofeedparser-vanilla-feed.xml"), feed) ?? [];
    const dates = items
      .map((item) => item.publishedAt)
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    const since = dates[Math.floor(dates.length / 2)] ?? new Date();
    const posts = (await walk(source, [feed], since.toISOString())).flatMap(
      (result) => result.posts,
    );

    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.postedAt.getTime()).toBeGreaterThan(since.getTime());
    }
    expect(posts.length).toBeLessThan(items.length);
  });

  it("takes every item on a first read, and never a reply", async () => {
    const feed = captured("mybb-feed.xml").replace(
      "<title><![CDATA[Feature to hide",
      "<title><![CDATA[Re: Feature to hide",
    );
    const stub = brightData({ [mybbFeed]: feed });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const posts = (await walk(source, [mybbFeed])).flatMap((result) => result.posts);

    expect(posts).toHaveLength(14);
    expect(posts.some((post) => post.externalId === "forum.kodi.tv:389554")).toBe(false);
  });

  it("gives a cut feed's new items as partial posts, and opens no thread", async () => {
    const stub = brightData({ [xenforoFeed]: captured("xenforo2-feed.xml") });
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch, "2026-10-31T05:00:00.000Z"), {
      onPage: (event) => events.push(event),
    });

    const since = "2026-10-31T04:00:00.000Z";
    const posts = (await walk(source, [xenforoFeed], since)).flatMap((result) => result.posts);

    expect(stub.asked.map((call) => call.url)).toEqual([xenforoFeed]);
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      // The id a thread page gives: the number after the slug.
      expect(post.externalId).toMatch(/^forums\.macrumors\.com:\d+$/);
      expect(post.partial).toEqual({ since: new Date(since) });
      expect(post.postedAt.getTime()).toBeGreaterThan(new Date(since).getTime());
    }
    expect(events[0]).toMatchObject({
      page: "feed",
      program: "xenforo2",
      threads: 0,
      posts: posts.length,
    });
  });
});

describe("reading a forum's activity stream", () => {
  const stream = manifest["invision5-stream.html"]?.url ?? "";
  const older = "https://forums.golfwrx.com/discover/?before=1793469636";
  const thread = "https://forums.golfwrx.com/topic/2113624-lab-vnz/";
  const beyond = "https://forums.golfwrx.com/discover/?before=1793467164";
  const refused = "Residential Failed (bad_endpoint): Requested site is not available";
  const pages = {
    [stream]: captured("invision5-stream.html"),
    [older]: captured("invision5-stream2.html"),
    [beyond]: refused,
  };
  const since = "2026-10-31T17:15:00.000Z";
  const newTopics = [
    "forums.golfwrx.com:2113624",
    "forums.golfwrx.com:2113623",
    "forums.golfwrx.com:2113622",
    "forums.golfwrx.com:2113621",
    "forums.golfwrx.com:2113620",
    "forums.golfwrx.com:2113619",
  ];

  it("reads page 1, then its older page, and gives both pages' new topics", async () => {
    const stub = brightData(pages);
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      onPage: (event) => events.push(event),
    });

    const results = await walk(source, [stream], since);

    expect(stub.asked.slice(0, 2).map((call) => call.url)).toEqual([stream, older]);
    const posts = results.flatMap((result) => result.posts);
    expect(posts.map((post) => post.externalId)).toEqual(newTopics);
    for (const post of posts) {
      expect(post.partial).toEqual({ since: new Date(since) });
      expect(post.url.startsWith("https://forums.golfwrx.com/topic/")).toBe(true);
    }
    expect(
      events
        .filter((event) => event.outcome === "read" && event.page === "feed")
        .map((event) => event.posts),
    ).toEqual([1, 5]);
  });

  it("stops at the stream page cap, page one or page two", async () => {
    const one = brightData(pages);
    const first = new BrightDataForumSource(runtimeWith(one.fetch), { streamPagesPerPoll: 1 });
    expect((await walk(first, [stream], since)).flatMap((result) => result.posts)).toHaveLength(1);
    expect(one.asked.map((call) => call.url)).toEqual([stream]);

    const two = brightData(pages);
    const second = new BrightDataForumSource(runtimeWith(two.fetch), { streamPagesPerPoll: 2 });
    expect((await walk(second, [stream], since)).flatMap((result) => result.posts)).toHaveLength(6);
    expect(two.asked.map((call) => call.url)).toEqual([stream, older]);
  });

  it("reads one page when there is no window yet", async () => {
    const stub = brightData(pages);
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const posts = (await walk(source, [stream])).flatMap((result) => result.posts);

    expect(stub.asked.map((call) => call.url)).toEqual([stream]);
    expect(posts.map((post) => post.externalId)).toEqual(["forums.golfwrx.com:2113624"]);
    expect(posts[0]?.partial).toEqual({});
  });

  it("asks for no older page when the window is newer than the page's oldest item", async () => {
    const stub = brightData(pages);
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const posts = (await walk(source, [stream], "2026-10-31T18:20:00.000Z")).flatMap(
      (result) => result.posts,
    );

    expect(stub.asked.map((call) => call.url)).toEqual([stream]);
    expect(posts.map((post) => post.externalId)).toEqual(["forums.golfwrx.com:2113624"]);
    expect(posts[0]?.partial).toEqual({ since: new Date("2026-10-31T18:20:00.000Z") });
  });

  it("decodes a cursor written before the stream had an older page", async () => {
    const stub = brightData(pages);
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));
    const cursor = Buffer.from(JSON.stringify({ index: 0 })).toString("base64url");

    const result = await source.search(request([stream], undefined, cursor));

    expect(stub.asked.map((call) => call.url)).toEqual([stream]);
    expect(result.posts.map((post) => post.externalId)).toEqual(["forums.golfwrx.com:2113624"]);
  });

  it("completes an Invision 5 stream topic from its thread page", async () => {
    const stub = brightData({ [thread]: captured("invision5-thread.html") });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const [result] = await completeAll(source, { posts: [{ url: thread }], credentials });

    expect(result).toMatchObject({
      status: "complete",
      unitsConsumed: 1,
      post: {
        externalId: "forums.golfwrx.com:2113624",
        title: "LAB VNZ",
        text: expect.stringContaining("34in. Heavy would be OK."),
        postedAt: new Date("2026-10-31T18:26:08.000Z"),
      },
    });
  });

  it("allows for the stream pages in its worst case", () => {
    expect(maxStreamPagesPerPoll).toBe(5);
    expect(
      createBrightDataForum({ threadsPerSection: 1, streamPagesPerPoll: 5 }).maxUnitsPerQueryPoll,
    ).toBe(5);
    expect(
      createBrightDataForum({
        threadsPerSection: 1,
        streamPagesPerPoll: 5,
        browser: { credentials: browserCredentials },
      }).maxUnitsPerQueryPoll,
    ).toBe(15);
    expect(() => createBrightDataForum({ streamPagesPerPoll: 0 })).toThrow(RangeError);
    expect(() => createBrightDataForum({ streamPagesPerPoll: 1.5 })).toThrow(RangeError);
  });
});

/** Each result one call gives, in order. */
async function completeAll(
  source: BrightDataForumSource,
  request: CompleteRequest,
): Promise<CompleteResult[]> {
  const results: CompleteResult[] = [];
  for await (const result of source.completePosts(request)) results.push(result);
  return results;
}

describe("completing a partial post", () => {
  const thread = "https://forums.macrumors.com/threads/m6-imac.2493064/";

  it("reads the thread's page, and gives the post whole", async () => {
    const stub = brightData({ [thread]: captured("xenforo2-thread.html") });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const [result] = await completeAll(source, { posts: [{ url: thread }], credentials });

    expect(result).toMatchObject({
      status: "complete",
      unitsConsumed: 1,
      post: {
        externalId: "forums.macrumors.com:2493064",
        title: "M6 iMac",
        text: expect.stringContaining("I ordered my M6 iMac this morning"),
        postedAt: new Date("2026-10-28T18:05:14.000Z"),
      },
    });
  });

  it("says a thread that started before the window is old, the page billed", async () => {
    const stub = brightData({ [thread]: captured("xenforo2-thread.html") });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const [result] = await completeAll(source, {
      posts: [{ url: thread, since: new Date("2026-10-29T00:00:00.000Z") }],
      credentials,
    });

    expect(result).toMatchObject({ status: "old", unitsConsumed: 1 });
  });

  it("says unread when no page comes back, billing nothing", async () => {
    const refused = "Residential Failed (bad_endpoint): Requested site is not available";
    const stub = brightData({ [thread]: refused });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch));

    const [result] = await completeAll(source, { posts: [{ url: thread }], credentials });

    expect(result).toMatchObject({
      status: "unread",
      unitsConsumed: 0,
    });
  });

  it("reads several posts through one browser, then stops it", async () => {
    const addresses = [
      thread,
      "https://forums.macrumors.com/threads/m6-imac.2493064/page-2",
      "https://forums.macrumors.com/threads/m6-imac.2493064/page-3",
    ];
    const stub = brightData({});
    const browser = fakeBrowser({}, captured("xenforo2-thread.html"));
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: browserCredentials, open: browser.open },
      fetcherFor: (host) => (host === "forums.macrumors.com" ? "browser" : undefined),
    });

    const results = await completeAll(source, {
      posts: addresses.map((url) => ({ url })),
      credentials,
    });

    expect(results.map((result) => result.status)).toEqual(["complete", "complete", "complete"]);
    expect(browser.read).toEqual(addresses);
    expect(browser.calls()).toEqual({ opened: 1, closed: 1 });
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
    // The default stream path's five pages are the larger worst case.
    expect(connector.maxUnitsPerQueryPoll).toBe(5);
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

describe("a challenge page is a refusal, not a page", () => {
  it("is read from a challenge's title or script, never a real page's words", async () => {
    const { refusalIn } = await import("./unlocker.js");
    expect(refusalIn("<html><head><title>Checking your browser</title></head></html>")).toBe(
      "the site answered with a challenge page",
    );
    expect(refusalIn("<html><head><title>Just a moment...</title></head></html>")).not.toBeNull();
    expect(
      refusalIn("<html><head><title>One moment, please...</title></head></html>"),
    ).not.toBeNull();
    expect(
      refusalIn("<html><head><script>window.POW_CHALLENGE_DATA = {}</script></head></html>"),
    ).not.toBeNull();
    // An empty answer, or a browser's page with nothing in it (BUG-481).
    expect(refusalIn("")).toBe("the site answered with an empty page");
    expect(refusalIn("  \n")).toBe("the site answered with an empty page");
    expect(refusalIn("<html><head></head><body></body></html>")).toBe(
      "the site answered with an empty page",
    );
    // A real page with little in it is still a page.
    expect(refusalIn("<html><head></head><body>ok</body></html>")).toBeNull();
    // A forum thread that talks about a captcha is still a page.
    expect(
      refusalIn(
        "<html><head><title>Captcha keeps failing on login</title></head><body>help</body></html>",
      ),
    ).toBeNull();
  });
});

const browserCredentials = {
  apiKey: "bu-key",
  proxyHost: "proxy.example",
  proxyPort: "1000",
  proxyUsername: "user",
  proxyPassword: "secret_country-US",
};
const challenge = "<html><head><title>Just a moment...</title></head><body></body></html>";

/**
 * A cloud browser that answers from captured pages: `pages` maps an address to
 * a body, `threads` answers every other address. It counts what a real one
 * bills: browsers started, pages read, and whether it was stopped.
 */
function fakeBrowser(pages: Record<string, string>, threads?: string) {
  const read: string[] = [];
  let opened = 0;
  let closed = 0;
  const open: OpenPageBrowser = () => {
    opened += 1;
    let started = 0;
    return {
      get started() {
        return started;
      },
      async read(url) {
        if (started === 0) started = 1;
        read.push(url);
        const body = pages[url] ?? threads;
        if (body === "throw") throw new Error("Browser Use answered 402");
        if (body === challenge)
          return {
            ok: false,
            reason: "the site answered with a challenge page",
            connection: false,
          };
        return body === undefined
          ? { ok: false, reason: "not captured", connection: false }
          : { ok: true, body };
      },
      async close() {
        closed += 1;
      },
    };
  };
  return {
    open,
    read,
    calls: () => ({ opened, closed }),
  };
}

describe("a page Bright Data cannot pass, read through the cloud browser", () => {
  it("reads the section and its threads through the browser, one browser a call", async () => {
    const stub = brightData({ [xenforoList]: challenge }, challenge);
    const browser = fakeBrowser(
      { [xenforoList]: captured("xenforo2-list.html") },
      captured("xenforo2-thread.html"),
    );
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: browserCredentials, open: browser.open },
      onPage: (event) => events.push(event),
    });

    const results = await walk(source, [xenforoList], "2026-10-28T18:00:00.000Z");

    expect(results.flatMap((result) => result.posts).map((post) => post.externalId)).toEqual([
      "forums.macrumors.com:2493064",
    ]);
    // Bright Data asked first each time; the browser read what it refused.
    expect(stub.asked.map((call) => call.url)).toEqual(browser.read);
    // A page, and the browser the call started: one unit each.
    expect(results.map((result) => result.unitsConsumed)).toEqual([2, 2]);
    expect(browser.calls()).toEqual({ opened: 2, closed: 2 });
    expect(
      events.map(({ page, via, outcome, program }) => ({ page, via, outcome, program })),
    ).toEqual([
      { page: "section", via: "browser", outcome: "read", program: "xenforo2" },
      { page: "thread", via: "browser", outcome: "read", program: "xenforo2" },
    ]);
    expect(events[0]).toMatchObject({ host: "forums.macrumors.com", threads: 1, units: 2 });
  });

  it("skips Bright Data for a forum the application sends to the browser", async () => {
    const stub = brightData({});
    const browser = fakeBrowser({ [xenforoList]: captured("xenforo2-list.html") });
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: browserCredentials, open: browser.open },
      fetcherFor: (host) => (host === "forums.macrumors.com" ? "browser" : undefined),
    });

    await source.search(request([xenforoList], "2026-10-30T06:00:00.000Z"));

    expect(stub.asked).toEqual([]);
    expect(browser.read).toEqual([xenforoList]);
  });

  it("reads through Bright Data a page the browser answers with a challenge", async () => {
    const stub = brightData({ [xenforoList]: captured("xenforo2-list.html") });
    const browser = fakeBrowser({ [xenforoList]: challenge });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {
      browser: { credentials: browserCredentials, open: browser.open },
      fetcherFor: (host) => (host === "forums.macrumors.com" ? "browser" : undefined),
    });

    const page = await fetcher.fetch(xenforoList);
    await fetcher.close();

    expect(stub.asked.map((call) => call.url)).toEqual([xenforoList]);
    expect(page.answer.ok).toBe(true);
    expect(page.via).toBe("unlocker");
    expect(page.units).toBe(2);
  });

  it("reads through Bright Data a page the browser throws on", async () => {
    const stub = brightData({ [xenforoList]: captured("xenforo2-list.html") });
    const browser = fakeBrowser({ [xenforoList]: "throw" });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {
      browser: { credentials: browserCredentials, open: browser.open },
      fetcherFor: (host) => (host === "forums.macrumors.com" ? "browser" : undefined),
    });

    const page = await fetcher.fetch(xenforoList);
    await fetcher.close();

    expect(stub.asked.map((call) => call.url)).toEqual([xenforoList]);
    expect(page.answer.ok).toBe(true);
    expect(page.via).toBe("unlocker");
    expect(page.units).toBe(2);
  });

  it("reads through the browser a page Bright Data answers empty", async () => {
    const stub = brightData({ [xenforoList]: "" });
    const browser = fakeBrowser({ [xenforoList]: captured("xenforo2-list.html") });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {
      browser: { credentials: browserCredentials, open: browser.open },
    });

    const page = await fetcher.fetch(xenforoList);
    await fetcher.close();

    expect(stub.asked.map((call) => call.url)).toEqual([xenforoList]);
    expect(page.answer.ok).toBe(true);
    expect(page.via).toBe("browser");
    expect(browser.read).toEqual([xenforoList]);
  });

  it("calls an empty page a refusal when no browser is set", async () => {
    const stub = brightData({ [xenforoList]: "<html><head></head><body></body></html>" });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {});

    const page = await fetcher.fetch(xenforoList);

    expect(page.answer).toEqual({ ok: false, reason: "the site answered with an empty page" });
    expect(page.units).toBe(0);
  });

  it("asks Bright Data once when it goes first and the browser reads the page", async () => {
    const stub = brightData({ [xenforoList]: challenge });
    const browser = fakeBrowser({ [xenforoList]: captured("xenforo2-list.html") });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {
      browser: { credentials: browserCredentials, open: browser.open },
    });

    const page = await fetcher.fetch(xenforoList);
    await fetcher.close();

    expect(stub.asked.map((call) => call.url)).toEqual([xenforoList]);
    expect(page.answer.ok).toBe(true);
    expect(page.via).toBe("browser");
  });

  it("starts no browser while Bright Data passes", async () => {
    const stub = brightData({ [xenforoList]: captured("xenforo2-list.html") });
    const browser = fakeBrowser({});
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: browserCredentials, open: browser.open },
    });

    const result = await source.search(request([xenforoList], "2026-10-30T06:00:00.000Z"));

    expect(result.unitsConsumed).toBe(1);
    expect(browser.read).toEqual([]);
    expect(browser.calls().closed).toBe(0);
  });

  it("never uses the browser without a proxy: its own costs ten times more", async () => {
    const stub = brightData({ [xenforoList]: challenge });
    const browser = fakeBrowser({ [xenforoList]: captured("xenforo2-list.html") });
    const { proxyHost: _proxy, ...withoutProxy } = browserCredentials;
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: withoutProxy, open: browser.open },
    });

    const result = await source.search(request([xenforoList]));

    expect(browser.read).toEqual([]);
    expect(result.unitsConsumed).toBe(0);
    expect(result.next).toEqual({ status: "done" });
  });

  it("skips a page the browser fails on, keeps the poll, and still stops the browser", async () => {
    const stub = brightData({ [xenforoList]: challenge });
    const browser = fakeBrowser({ [xenforoList]: "throw" });
    const events: ForumPageEvent[] = [];
    const source = new BrightDataForumSource(runtimeWith(stub.fetch), {
      browser: { credentials: browserCredentials, open: browser.open },
      onPage: (event) => {
        events.push(event);
        throw new Error("a broken handler is not the poll's problem");
      },
    });

    const result = await source.search(request([xenforoList]));

    expect(result.next).toEqual({ status: "done" });
    expect(browser.calls()).toEqual({ opened: 1, closed: 1 });
    expect(events).toMatchObject([{ via: "browser", outcome: "refused" }]);
  });

  it("stops the browser when the call fails for another reason", async () => {
    const browser = fakeBrowser({}, captured("xenforo2-thread.html"));
    const failing: typeof globalThis.fetch = async () => new Response("no", { status: 401 });
    let asked = 0;
    const source = new BrightDataForumSource(runtimeWith(failing), {
      browser: { credentials: browserCredentials, open: browser.open },
      // The first thread to the browser, the second to Bright Data, which refuses the key.
      fetcherFor: () => (asked++ === 0 ? "browser" : undefined),
    });
    const pending = encodeForTest([
      { url: "https://forums.macrumors.com/threads/m6-imac.2493064/", approximate: false },
      { url: "https://forums.macrumors.com/threads/other.1/", approximate: false },
    ]);

    await expect(source.search(request([xenforoList], undefined, pending))).rejects.toThrow(
      "Bright Data refused the API key.",
    );
    expect(browser.read).toHaveLength(1);
    expect(browser.calls()).toEqual({ opened: 1, closed: 1 });
  });

  it("serves an application's own pages, one browser until it is closed", async () => {
    const other = "https://forums.macrumors.com/forums/imac.91/";
    const stub = brightData({ [xenforoList]: challenge, [other]: challenge });
    const browser = fakeBrowser({ [xenforoList]: "list", [other]: "other" });
    const fetcher = openForumFetcher(runtimeWith(stub.fetch), credentials, {
      browser: { credentials: browserCredentials, open: browser.open },
    });

    const first = await fetcher.fetch(xenforoList);
    const second = await fetcher.fetch(other);
    await fetcher.close();

    expect([first.via, second.via]).toEqual(["browser", "browser"]);
    // The browser's start is counted once, on the page that started it.
    expect([first.units, second.units]).toEqual([2, 1]);
    expect(browser.calls()).toEqual({ opened: 1, closed: 1 });
  });

  it("allows for a retry and a browser in its worst case", () => {
    expect(createBrightDataForum({ threadsPerSection: 8 }).maxUnitsPerQueryPoll).toBe(9);
    expect(
      createBrightDataForum({
        threadsPerSection: 8,
        browser: { credentials: browserCredentials },
      }).maxUnitsPerQueryPoll,
    ).toBe(2 * 9 + 1 + 2);
  });
});

/** A cursor holding threads still to open, as the source writes one. */
function encodeForTest(pending: { url: string; approximate: boolean }[]): string {
  return Buffer.from(JSON.stringify({ index: 0, pending })).toString("base64url");
}
