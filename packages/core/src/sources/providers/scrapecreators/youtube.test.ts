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
  commentLink,
  precisionOf,
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
/** US-135: two pages of a 419-comment thread, and the same page ranked `top`. */
const commentsPage1 = fixture("comments-deep-page-1");
const commentsPage2 = fixture("comments-deep-page-2");
const commentsTop = fixture("comments-deep-top");
/** The one-comment thread US-121 found, with no continuation. */
const commentsSingle = fixture("comments-newest");
const ledger = JSON.parse(
  readFileSync(new URL("./youtube-fixtures/ledger.json", import.meta.url), "utf8"),
) as unknown;

interface RawComment {
  readonly id: string;
  readonly content: string;
  readonly publishedTimeText?: string;
  readonly publishedTime?: string;
  readonly replyLevel?: number;
  readonly engagement?: { readonly replies?: number };
  readonly repliesContinuationToken?: string;
}

function commentsOf(captured: Captured): readonly RawComment[] {
  return (captured.body as { comments?: readonly RawComment[] }).comments ?? [];
}

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
   * US-135. A comment page is one credit, the same as a search, so there is no
   * separate reply price to declare — the ledger says both calls charged 1.
   */
  it("promises replies at the one price every endpoint on this key costs", () => {
    expect(scrapeCreatorsYouTube.canFetchReplies).toBe(true);
    expect(scrapeCreatorsYouTube.replyPricePerUnitMicros).toBeUndefined();

    const calls = (ledger as { calls: { call: string; creditsCharged: number }[] }).calls;
    const commentCalls = calls.filter((entry) => entry.call.startsWith("comments-deep"));
    expect(commentCalls.length).toBeGreaterThan(0);
    for (const entry of commentCalls) expect(entry.creditsCharged).toBe(1);
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

/** The video the deep capture asked about, read off the manifest by eye. */
const threadUrl = "https://www.youtube.com/watch?v=BQqzfHQkREo";
const threadId = "BQqzfHQkREo";

function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
  return { postUrl: threadUrl, postExternalId: threadId, credentials, ...overrides };
}

describe("comments", () => {
  it("reads a captured page into replies, one credit for twenty", async () => {
    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.itemsReturned).toBe(20);
    expect(result.replies).toHaveLength(20);
    expect(result.unitsConsumed).toBe(1);
    // BUG-020: the usage row multiplies units by the reply price, so the
    // product is what a page is recorded at, and it must be what it cost.
    expect(
      result.unitsConsumed *
        (scrapeCreatorsYouTube.replyPricePerUnitMicros ?? scrapeCreatorsYouTube.pricePerUnitMicros),
    ).toBe(1880);
  });

  it("asks by video URL, newest first, and follows continuationToken on the next page", async () => {
    const stub = provider([commentsPage1, commentsPage2]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const first = await source.fetchReplies(replyRequest());
    expect(first.next.status).toBe("ready");
    const cursor = first.next.status === "ready" ? first.next.cursor : undefined;

    const second = await source.fetchReplies(replyRequest({ cursor, positionOffset: 20 }));

    const asked = stub.calls.map((call) => new URL(call.url));
    expect(asked[0]?.pathname).toBe("/v1/youtube/video/comments");
    expect(asked[0]?.searchParams.get("url")).toBe(threadUrl);
    expect(asked[0]?.searchParams.get("order")).toBe("newest");
    expect(asked[0]?.searchParams.get("continuationToken")).toBeNull();
    expect(asked[1]?.searchParams.get("continuationToken")).toBe(cursor);

    // Page two repeated none of page one: measured, and the reason paging is
    // worth a credit.
    const seen = new Set(first.replies.map((reply) => reply.externalId));
    expect(second.replies.some((reply) => seen.has(reply.externalId))).toBe(false);
    expect(second.replies[0]?.threadPosition).toBe(20);
  });

  it("hangs every reply under the video it asked about, with no parent reply", async () => {
    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    for (const reply of replies) {
      expect(reply.parentPostExternalId).toBe(threadId);
      expect(reply.parentReplyExternalId).toBeUndefined();
    }
    // Nothing on the page is nested: a subtree is behind its own token.
    expect(commentsOf(commentsPage1).every((comment) => comment.replyLevel === 0)).toBe(true);
  });

  it("builds YouTube's own comment link from the video URL and the comment id", () => {
    const first = commentsOf(commentsPage1)[0] as RawComment;

    expect(commentLink(threadUrl, first.id)).toBe(`${threadUrl}&lc=${first.id}`);
  });

  it("reads the author's channel name and the reply count the platform gave", () => {
    const first = commentsOf(commentsPage1)[0] as RawComment;
    const reply = toCandidateReply(first, {
      parentPostExternalId: threadId,
      position: 0,
      postUrl: threadUrl,
    });

    expect(reply?.author).toBe("yt-channel-1");
    expect(reply?.replyCount).toBe(18);
    expect(reply?.text).toBe(first.content);
  });

  it("drops a comment with no id, no text or no date rather than repairing it", () => {
    const first = commentsOf(commentsPage1)[0] as RawComment;
    const context = { parentPostExternalId: threadId, position: 0, postUrl: threadUrl };

    expect(toCandidateReply({ ...first, id: "" }, context)).toBeUndefined();
    expect(toCandidateReply({ ...first, content: "" }, context)).toBeUndefined();
    expect(toCandidateReply({ ...first, publishedTime: "not a date" }, context)).toBeUndefined();
  });

  /**
   * Every comment on a page carries the same time of day, because the
   * provider subtracts "4 years ago" from the moment of the call. The fixture
   * is read here rather than described, so this fails if the provider starts
   * sending a real date — which would be the moment to stop marking it.
   */
  it("marks every date approximate, because the page proves it is computed", async () => {
    const clocks = new Set(
      commentsOf(commentsPage1).map((comment) => String(comment.publishedTime).slice(11)),
    );
    expect(clocks.size).toBe(1);

    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());
    for (const reply of replies) expect(reply.postedAtIsApproximate).toBe(true);
  });

  it("reads how approximate from the relative text", () => {
    expect(precisionOf("3 weeks ago")).toBe(7 * 86_400_000);
    expect(precisionOf("4 years ago")).toBe(366 * 86_400_000);
    expect(precisionOf("4 years ago (edited)")).toBe(366 * 86_400_000);
    expect(precisionOf("a day ago")).toBe(86_400_000);
    expect(precisionOf("1 month ago")).toBe(31 * 86_400_000);
    expect(precisionOf("yesterday")).toBeUndefined();
    expect(precisionOf(undefined)).toBeUndefined();
  });

  /**
   * The cut is made at the precision of the text, not at the second. The
   * captured "4 years ago" comments are safely older than a thirty-day window
   * and are dropped; a "3 weeks ago" comment could have been written any day
   * of that week and is kept on the boundary rather than lost.
   */
  it("cuts on since at the precision of the text, keeping the boundary", async () => {
    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    const thirtyDaysBefore = new Date(now.getTime() - 30 * 86_400_000);
    const cut = await source.fetchReplies(replyRequest({ since: thirtyDaysBefore }));

    expect(cut.replies).toHaveLength(0);
    // Still billed, and still counted: an empty page is not a free one.
    expect(cut.itemsReturned).toBe(20);
    expect(cut.unitsConsumed).toBe(1);

    const single = commentsOf(commentsSingle)[0] as RawComment;
    expect(single.publishedTimeText).toBe("3 weeks ago");
    const computed = new Date(single.publishedTime as string);
    const context = { parentPostExternalId: "fSr0QCEB8uE", position: 0, postUrl: threadUrl };
    const reply = toCandidateReply(single, context);
    expect(reply?.postedAtPrecisionMs).toBe(7 * 86_400_000);

    // Six days after the computed date is inside the week the text allows.
    const sixDaysLater = new Date(computed.getTime() + 6 * 86_400_000);
    const eightDaysLater = new Date(computed.getTime() + 8 * 86_400_000);
    const kept = await new ScrapeCreatorsYouTubeSource(
      runtimeWith(provider([commentsSingle]).fetch),
    ).fetchReplies(replyRequest({ since: sixDaysLater }));
    const dropped = await new ScrapeCreatorsYouTubeSource(
      runtimeWith(provider([commentsSingle]).fetch),
    ).fetchReplies(replyRequest({ since: eightDaysLater }));

    expect(kept.replies).toHaveLength(1);
    expect(dropped.replies).toHaveLength(0);
  });

  it("keeps a comment whose relative text it cannot read", async () => {
    const body = commentsSingle.body as Record<string, unknown>;
    const odd: Captured = {
      httpStatus: 200,
      body: {
        ...body,
        comments: (body.comments as Record<string, unknown>[]).map((comment) => ({
          ...comment,
          publishedTimeText: "yesterday",
        })),
      },
    };
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(provider([odd]).fetch));

    const result = await source.fetchReplies(replyRequest({ since: now }));

    expect(result.replies).toHaveLength(1);
  });

  /**
   * Measured: `order=newest` is not date order — a two-year-old comment sits
   * on page two behind nineteen four-year-old ones — and `order=top` returns
   * nineteen of the same twenty. So the walk never stops early on an old
   * comment, and the two fixtures are read here to keep that claim honest.
   */
  it("is not in date order, so no page ends the walk early", async () => {
    const texts = [...commentsOf(commentsPage1), ...commentsOf(commentsPage2)].map(
      (comment) => comment.publishedTimeText,
    );
    expect(texts.slice(0, 20).every((text) => text?.startsWith("4 years ago"))).toBe(true);
    expect(texts.slice(20)).toContain("2 years ago");

    const newestIds = new Set(commentsOf(commentsPage1).map((comment) => comment.id));
    const shared = commentsOf(commentsTop).filter((comment) => newestIds.has(comment.id));
    expect(shared).toHaveLength(19);

    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));
    const result = await source.fetchReplies(replyRequest({ since: new Date("2024-01-01") }));
    expect(result.next.status).toBe("ready");
  });

  /**
   * Seven of the twenty comments on the captured page claim replies — 18, 2,
   * 11, 17, 4, 1 and 1 — and each carries a token to fetch them. This
   * connector follows none, so the page is partial.
   */
  it("says the thread is partial when comments carry unread replies", async () => {
    const claimed = commentsOf(commentsPage1).filter(
      (comment) => (comment.engagement?.replies ?? 0) > 0,
    );
    expect(claimed).toHaveLength(7);
    expect(claimed.every((comment) => comment.repliesContinuationToken)).toBe(true);

    const stub = provider([commentsPage1]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));

    expect((await source.fetchReplies(replyRequest())).partial).toBe(true);
  });

  it("calls a one-comment thread with no continuation and no replies complete", async () => {
    const single = commentsOf(commentsSingle)[0] as RawComment;
    expect(single.engagement?.replies).toBe(0);
    expect(single.repliesContinuationToken).toBeUndefined();

    const stub = provider([commentsSingle]);
    const source = new ScrapeCreatorsYouTubeSource(runtimeWith(stub.fetch));
    const result = await source.fetchReplies(replyRequest());

    expect(result.next.status).toBe("done");
    expect(result.partial).toBe(false);
    expect(result.replies).toHaveLength(1);
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
