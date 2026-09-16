/**
 * The ScrapeCreators YouTube connector, driven against payloads captured from a
 * live account by `youtube-fixtures/capture.mjs` on 2026-09-11.
 *
 * Nothing here reaches the network. docs/testing.md, *No test spends money*.
 *
 * The literals were read out of the fixtures by eye. Re-running the capture
 * collects different videos and will change them; that is a deliberate edit to
 * make at the same time, not a reason to derive them from the code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { youTubePlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { scrapeCreatorsProviderId } from "./provider.js";
import {
  ScrapeCreatorsYouTubeSource,
  scrapeCreatorsYouTube,
  toCandidatePost,
  windowFor,
} from "./youtube.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./youtube-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

/** The answer this connector actually asks for: extras on, videos only. */
const withExtras = fixture("search-with-extras");
/** The same query without the extras, which is what the trap looks like. */
const plain = fixture("search-videos");
const mixed = fixture("search-mixed");
const noResults = fixture("search-no-results");
const credentialsRejected = fixture("credentials-rejected");
const credentialsAccepted = fixture("credentials-accepted");

interface RawVideo {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly publishDate?: string;
  readonly publishedTime?: string;
  readonly commentCountInt?: number;
  readonly channel?: { readonly handle?: string; readonly title?: string };
}

function videosOf(captured: Captured): readonly RawVideo[] {
  return (captured.body as { videos?: readonly RawVideo[] }).videos ?? [];
}

function provider(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: { url: string }[] = [];

  const fetchStub: typeof globalThis.fetch = (input) => {
    calls.push({ url: String(input) });
    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;

    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.httpStatus }));
  };

  return { fetch: fetchStub, calls };
}

const now = new Date("2026-09-11T16:00:00.000Z");

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "scrapecreators-youtube-test" }),
  };
}

const credentials = { apiKey: "a-scrapecreators-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: ["flaky tests"], channels: [] }, credentials, ...overrides };
}

describe("the connector's declared economics", () => {
  it("is YouTube fetched by ScrapeCreators, the second provider for that platform", () => {
    expect(scrapeCreatorsYouTube.platform.id).toBe(youTubePlatformId);
    expect(scrapeCreatorsYouTube.provider.id).toBe(scrapeCreatorsProviderId);
    assertSourcesCanBeStored([scrapeCreatorsYouTube.platform.id]);
  });

  it("bills a request at this provider's one price", () => {
    expect(scrapeCreatorsYouTube.billableUnit).toBe("request");
    expect(scrapeCreatorsYouTube.pricePerUnitMicros).toBe(1880);
    expect(scrapeCreatorsYouTube.postsPerUnit).toBe(20);
  });

  /**
   * US-121 measured one comment across twenty videos, and it was "nice video
   * sir". A comment here also has no permalink, no parent id, and a date
   * computed from "3 weeks ago" that no parameter corrects.
   */
  it("does not promise replies it should not be asked for", () => {
    expect(scrapeCreatorsYouTube.canFetchReplies).toBe(false);
    expect(scrapeCreatorsYouTube.replyPricePerUnitMicros).toBeUndefined();
  });
});

describe("the window a search asks for", () => {
  it("sends no window when the monitor has no since", () => {
    expect(windowFor(undefined, now)).toBeUndefined();
  });

  it("picks the narrowest window that still covers since", () => {
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

    expect(windowFor(ago(0.5), now)).toBe("today");
    expect(windowFor(ago(1), now)).toBe("today");
    expect(windowFor(ago(2), now)).toBe("this_week");
    expect(windowFor(ago(7), now)).toBe("this_week");
    expect(windowFor(ago(8), now)).toBe("this_month");
    expect(windowFor(ago(31), now)).toBe("this_month");
    expect(windowFor(ago(32), now)).toBe("this_year");
    expect(windowFor(ago(366), now)).toBe("this_year");
  });

  it("sends no window at all when since reaches past the widest one", () => {
    // This endpoint has no "all time" value, so the unfiltered page is the
    // answer rather than an invented parameter.
    expect(windowFor(new Date(now.getTime() - 400 * 86_400_000), now)).toBeUndefined();
  });
});

describe("what a search sends", () => {
  it("always asks for the extras, because they carry the real date", async () => {
    const stub = provider([withExtras]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    await source.search(request());

    const asked = new URL(stub.calls[0]?.url ?? "");
    expect(asked.pathname).toBe("/v1/youtube/search");
    expect(asked.searchParams.get("includeExtras")).toBe("true");
    expect(asked.searchParams.get("type")).toBe("videos");
  });

  it("narrows the window to what the monitor asked for", async () => {
    const stub = provider([withExtras]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date(now.getTime() - 3 * 86_400_000),
        },
      }),
    );

    expect(new URL(stub.calls[0]?.url ?? "").searchParams.get("uploadDate")).toBe("this_week");
  });

  it("sends no window when the monitor names no since", async () => {
    const stub = provider([withExtras]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    await source.search(request());

    expect(new URL(stub.calls[0]?.url ?? "").searchParams.has("uploadDate")).toBe(false);
  });
});

describe("the date, which is the trap on this endpoint", () => {
  /**
   * The evidence, straight out of the fixture.
   *
   * `publishedTime` is computed by subtracting "3 weeks ago" from the moment of
   * the call, so every video in one answer shares a time of day. If this ever
   * stops being true, the reason for `includeExtras` has changed and this test
   * is where it says so.
   */
  it("shows publishedTime to be arithmetic rather than a timestamp", () => {
    const clocksOf = (pick: (video: RawVideo) => string | undefined) =>
      new Set(
        videosOf(withExtras)
          .map((video) => pick(video) ?? "")
          .filter(Boolean)
          .map((stamp) => stamp.slice(11, 19)),
      );

    const computed = clocksOf((video) => video.publishedTime);
    const real = clocksOf((video) => video.publishDate);

    // Twenty videos published at twenty different times of day, and one or two
    // distinct clock readings across the computed field — because it is "now
    // minus three weeks", evaluated as the answer was assembled.
    expect(videosOf(withExtras).length).toBeGreaterThan(5);
    expect(computed.size).toBeLessThanOrEqual(2);
    expect(real.size).toBeGreaterThan(computed.size * 4);
  });

  it("stores publishDate, not the computed one", () => {
    const raw = videosOf(withExtras)[0];
    const post = toCandidatePost(raw);

    expect(raw?.publishDate).toBeDefined();
    expect(post?.postedAt.toISOString()).toBe(new Date(raw?.publishDate ?? "").toISOString());
    expect(post?.postedAt.toISOString()).not.toBe(new Date(raw?.publishedTime ?? "").toISOString());
    expect(post?.postedAtIsApproximate).toBeUndefined();
  });

  it("marks the fallback approximate when the real date is missing", () => {
    const raw = videosOf(plain)[0];

    // The plain search carries no publishDate at all, which is what an answer
    // looks like when the extras did not reach the call.
    expect(raw?.publishDate).toBeUndefined();
    expect(toCandidatePost(raw)?.postedAtIsApproximate).toBe(true);
  });

  it("keeps an approximate post through the since cut rather than losing a lead", async () => {
    const stub = provider([plain]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: now } }),
    );

    // Every date in this fixture is approximate and all of them are older than
    // `since`. US-034 settled the direction: dropping a video because the
    // provider was vague loses a lead nobody can tell was lost.
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.every((post) => post.postedAtIsApproximate)).toBe(true);
  });
});

describe("reading a captured page", () => {
  it("stores the title and the description together", () => {
    const raw = videosOf(withExtras)[0];
    const post = toCandidatePost(raw);

    expect(raw?.description).toBeDefined();
    expect(post?.title).toBe(raw?.title);
    expect(post?.text).toContain(raw?.title ?? "");
    expect(post?.text).toContain(raw?.description ?? "");
  });

  it("gives the classifier far more than a title", () => {
    // The whole argument for this connector: a title is 68 characters at the
    // median and the description is over a thousand.
    const posts = videosOf(withExtras)
      .map((video) => toCandidatePost(video))
      .filter((post) => post !== undefined);

    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;

    expect(median(posts.map((post) => (post.title ?? "").length))).toBeLessThan(200);
    expect(median(posts.map((post) => post.text.length))).toBeGreaterThan(500);
  });

  it("stores a video with no description as just its title", () => {
    const raw = videosOf(withExtras)[0];
    const post = toCandidatePost({ ...raw, description: "" });

    expect(post?.text).toBe(raw?.title);
  });

  it("uses YouTube's own video id and clean URL, which deduplicate against SocialCrawl", () => {
    // This provider's fixture is the body alone, where the TikTok one carries a
    // status wrapper. Read what is there rather than assuming one shape.
    const socialCrawl = JSON.parse(
      readFileSync(
        new URL("../socialcrawl/youtube-fixtures/search-plain.json", import.meta.url),
        "utf8",
      ),
    ) as { data: { items: readonly { post: { id: string; url: string } }[] } };

    const theirs = socialCrawl.data.items[0]?.post;
    const ours = toCandidatePost(videosOf(withExtras)[0]);

    // Eleven characters, and `watch?v=` holding exactly that id. Unlike TikTok,
    // nothing has to be stripped first.
    expect(theirs?.id).toMatch(/^[\w-]{11}$/);
    expect(ours?.externalId).toMatch(/^[\w-]{11}$/);
    expect(theirs?.url).toBe(`https://www.youtube.com/watch?v=${theirs?.id}`);
    expect(ours?.url).toBe(`https://www.youtube.com/watch?v=${ours?.externalId}`);
  });

  it("drops a record with no id, no title or no date rather than repairing it", () => {
    const raw = videosOf(withExtras)[0];

    expect(toCandidatePost({ ...raw, id: "" })).toBeUndefined();
    expect(toCandidatePost({ ...raw, title: "" })).toBeUndefined();
    expect(toCandidatePost({ ...raw, publishDate: "", publishedTime: "" })).toBeUndefined();
  });

  it("reports the comment count the extras gave", () => {
    const withComments = videosOf(withExtras).find((video) => (video.commentCountInt ?? 0) > 0);

    expect(toCandidatePost(withComments)?.replyCount).toBe(withComments?.commentCountInt);
    expect(
      toCandidatePost({ ...videosOf(withExtras)[0], commentCountInt: undefined })?.replyCount,
    ).toBeUndefined();
  });
});

describe("what the answer holds beside videos", () => {
  /**
   * The answer is one array per kind, so reading `videos` cannot store a
   * channel. This is asserted against the fixture captured *without* `type`,
   * which is the answer a dropped parameter would produce.
   */
  it("reads only videos, even from an answer holding shorts and playlists", async () => {
    const body = mixed.body as Record<string, readonly unknown[]>;
    const stub = provider([mixed]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect((body.shorts ?? []).length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThanOrEqual((body.videos ?? []).length);
  });

  it("reads an honest empty answer as an empty page, and still counts the credit", async () => {
    // Unlike TikTok, which returns thirty unrelated videos and claims success,
    // this endpoint answers with nothing. It is billed either way.
    const stub = provider([noResults]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(result.posts).toHaveLength(0);
    expect(result.unitsConsumed).toBe(1);
    expect(result.next.status).toBe("done");
  });
});

describe("paging", () => {
  it("follows the continuation token the provider sends", async () => {
    const stub = provider([withExtras, plain]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    const token = (withExtras.body as { continuationToken?: string }).continuationToken;

    expect(token).toBeTruthy();
    expect(one.next.status).toBe("ready");

    await source.search(request({ cursor: (one.next as { cursor: string }).cursor }));
    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("continuationToken")).toBe(token);
  });

  it("stops after the pages one query is allowed", async () => {
    const stub = provider([withExtras]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    const two = await source.search(request({ cursor: (one.next as { cursor: string }).cursor }));

    expect(two.next.status).toBe("done");
  });

  /**
   * The rule `reddit.ts` has and this connector must not.
   *
   * The page is ranked by relevance, so a page whose every video is older than
   * `since` says nothing about the next page.
   */
  it("does not stop paging because a page is entirely older than since", async () => {
    const stub = provider([withExtras]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: now } }),
    );

    expect(result.posts).toHaveLength(0);
    expect(result.next.status).toBe("ready");
  });

  it("moves to the next query when one query runs out of pages", async () => {
    const stub = provider([noResults]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["flaky tests", "brittle suites"], channels: [] } }),
    );

    expect(result.next.status).toBe("ready");

    const second = await source.search(
      request({
        query: { queries: ["flaky tests", "brittle suites"], channels: [] },
        cursor: (result.next as { cursor: string }).cursor,
      }),
    );

    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("query")).toBe("brittle suites");
    expect(second.next.status).toBe("done");
  });
});

describe("credentials", () => {
  it("refuses an empty key without asking the provider", async () => {
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(provider([]).fetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your ScrapeCreators API key.",
    });
  });

  it("reads the provider's own refusal back to the person", async () => {
    const stub = provider([credentialsRejected]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
    expect(check.valid === false && check.reason).toContain("ScrapeCreators rejected the API key");
  });

  it("accepts a key the provider let past authentication, for nothing", async () => {
    const stub = provider([credentialsAccepted]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    expect(await source.validateCredentials(credentials)).toEqual({ valid: true });
    expect((credentialsAccepted.body as { credits_charged: number }).credits_charged).toBe(0);
  });
});
