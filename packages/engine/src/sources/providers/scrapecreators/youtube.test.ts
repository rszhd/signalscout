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
import type { ReplyRequest, SearchRequest, SourceRuntime } from "../../types.js";
import { scrapeCreatorsProviderId } from "./provider.js";
import {
  ScrapeCreatorsYouTubeSource,
  scrapeCreatorsYouTube,
  toCandidatePost,
  toCandidateReply,
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
/** The comment pages, captured on 2026-09-17 by US-159. */
const comments = fixture("comments-newest");
const commentsPageTwo = fixture("comments-newest-page-2");
const commentsTop = fixture("comments-top");

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

  it("fetches replies, at the same credit a search costs", () => {
    expect(scrapeCreatorsYouTube.canFetchReplies).toBe(true);
    expect(scrapeCreatorsYouTube.replyPricePerUnitMicros).toBe(1880);
    expect(
      new ScrapeCreatorsYouTubeSource(runtimeWith(provider([]).fetch)).fetchReplies,
    ).toBeTypeOf("function");
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

/**
 * The replies under one video. US-159.
 *
 * Every payload here was captured on 2026-09-17 against a video claiming 419
 * comments, because the keyword the rest of this file uses has almost none:
 * US-121 found one comment across twenty videos in that niche, which is enough
 * evidence to decide against a connector and not enough to build one.
 */
describe("the replies under one video", () => {
  const videoId = "a-video-id";

  function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
    return {
      postUrl: `https://www.youtube.com/watch?v=${videoId}`,
      postExternalId: videoId,
      credentials,
      ...overrides,
    };
  }

  function rawComments(captured: Captured): readonly Record<string, unknown>[] {
    return (captured.body as { comments?: readonly Record<string, unknown>[] }).comments ?? [];
  }

  /**
   * The measurement the whole connector rests on, asserted against the
   * fixtures rather than trusted from the Log.
   *
   * If a later capture shows this provider filling either field in, these two
   * expectations fail — and the built link and the missing parent become
   * repairs of a problem that no longer exists.
   */
  it("carries neither a permalink nor a parent id on any captured comment", () => {
    const all = [...rawComments(comments), ...rawComments(commentsPageTwo)];

    expect(all.length).toBe(40);
    expect(all.filter((comment) => comment.url !== undefined)).toHaveLength(0);
    expect(all.filter((comment) => comment.post_id ?? comment.parentId)).toHaveLength(0);
    expect(all.every((comment) => comment.replyLevel === 0)).toBe(true);
  });

  it("reads a page of twenty comments for one credit", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.itemsReturned).toBe(20);
    expect(result.replies).toHaveLength(20);
    expect(result.unitsConsumed).toBe(1);
  });

  it("asks for the newest order, whatever the provider does with it", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    await source.fetchReplies(replyRequest());

    const asked = new URL(stub.calls[0]?.url ?? "");
    expect(asked.pathname).toBe("/v1/youtube/video/comments");
    expect(asked.searchParams.get("order")).toBe("newest");
    expect(asked.searchParams.get("url")).toBe(`https://www.youtube.com/watch?v=${videoId}`);
  });

  /**
   * `top` and `newest` were asked for the same video back to back and answered
   * with the same comments in the same order. This is why nothing in the
   * connector stops early on a date.
   */
  it("was measured returning the same page under both orderings", () => {
    const newest = rawComments(comments).map((comment) => comment.id);
    const top = rawComments(commentsTop).map((comment) => comment.id);

    expect(top[0]).toBe(newest[0]);
  });

  it("builds YouTube's own linked-comment URL, because the provider sends none", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    for (const reply of replies) {
      expect(reply.url).toBe(`https://www.youtube.com/watch?v=${videoId}&lc=${reply.externalId}`);
    }
  });

  /**
   * Twenty comments on one page shared one timestamp to the millisecond,
   * because the provider subtracts "4 years ago" from the moment of the call.
   * Nothing downstream may read that as a reading.
   */
  it("marks every date approximate, because every date is arithmetic", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    expect(replies.every((reply) => reply.postedAtIsApproximate === true)).toBe(true);
    expect(new Set(replies.map((reply) => reply.postedAt.getTime())).size).toBe(1);
  });

  it("never claims a parent reply, because no comment names one", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    expect(replies.every((reply) => reply.parentReplyExternalId === undefined)).toBe(true);
    expect(replies.every((reply) => reply.parentPostExternalId === videoId)).toBe(true);
  });

  it("pages with the continuation token, and page two repeats nothing", async () => {
    const stub = provider([comments, commentsPageTwo]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const first = await source.fetchReplies(replyRequest());
    expect(first.next.status).toBe("ready");

    const cursor = first.next.status === "ready" ? first.next.cursor : undefined;
    const second = await source.fetchReplies(replyRequest({ cursor }));

    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("continuationToken")).toBe(cursor);

    const seen = new Set(first.replies.map((reply) => reply.externalId));
    expect(second.replies.filter((reply) => seen.has(reply.externalId))).toHaveLength(0);
  });

  it("counts the provider's own position across the whole walk", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest({ positionOffset: 20 }));

    expect(replies[0]?.threadPosition).toBe(20);
    expect(replies.at(-1)?.threadPosition).toBe(39);
  });

  /**
   * The cut this connector makes on a date it has already called approximate,
   * and the one place it departs from `search` above. US-034 is why: keeping
   * every comment because its date is computed is how a comment from 2021
   * reached an inbox as a lead.
   */
  it("applies the window even though the date is the provider's arithmetic", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const all = await source.fetchReplies(replyRequest());
    const newest = all.replies.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));

    const later = await source.fetchReplies(replyRequest({ since: newest.postedAt }));

    expect(later.replies).toHaveLength(0);
    // Still billed and still counted. An empty page is not a free one.
    expect(later.itemsReturned).toBe(all.itemsReturned);
    expect(later.unitsConsumed).toBe(1);
  });

  /**
   * A comment with a thread of its own is a second walk with a second bill,
   * and this connector does not make it. Saying so is what stops the thread
   * being recorded as fully read.
   */
  it("reports a thread as partial while comments hold unread replies", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(
      rawComments(comments).some((comment) => comment.repliesContinuationToken !== undefined),
    ).toBe(true);
    expect(result.partial).toBe(true);
  });

  it("drops a comment with no words, rather than buying a classification for silence", () => {
    const first = rawComments(comments)[0] as Record<string, unknown>;

    expect(
      toCandidateReply({ ...first, content: "" }, { parentPostExternalId: videoId, position: 0 }),
    ).toBeUndefined();
    expect(
      toCandidateReply({ ...first, id: "" }, { parentPostExternalId: videoId, position: 0 }),
    ).toBeUndefined();
  });
});
