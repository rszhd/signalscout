/**
 * The ScrapeCreators TikTok connector, driven against payloads captured from a
 * live account by `tiktok-fixtures/capture.mjs` on 2026-09-11.
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
import { tikTokPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { ReplyRequest, SearchRequest, SourceRuntime } from "../../types.js";
import { scrapeCreatorsProviderId } from "./provider.js";
import {
  cleanPostUrl,
  ScrapeCreatorsTikTokSource,
  scrapeCreatorsTikTok,
  toCandidatePost,
  toCandidateReply,
  windowFor,
} from "./tiktok.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./tiktok-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const wholePage = fixture("search-page-whole");
const comments = fixture("comments-page-1");
const credentialsRejected = fixture("credentials-rejected");
const credentialsAccepted = fixture("credentials-accepted");

/** The one video kept whole, outside any page. */
const wholeVideo = JSON.parse(
  readFileSync(new URL("./tiktok-fixtures/video-whole.json", import.meta.url), "utf8"),
) as { readonly item: unknown };

function itemsOf(captured: Captured): readonly unknown[] {
  return (captured.body as { search_item_list?: readonly unknown[] }).search_item_list ?? [];
}

function commentsOf(captured: Captured): readonly unknown[] {
  return (captured.body as { comments?: readonly unknown[] }).comments ?? [];
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

/** The day after the capture, so the fixtures sit just inside a short window. */
const now = new Date("2026-09-11T16:00:00.000Z");

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "scrapecreators-tiktok-test" }),
  };
}

const credentials = { apiKey: "a-scrapecreators-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: ["flaky tests"], channels: [] }, credentials, ...overrides };
}

function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
  const first = commentsOf(comments)[0] as { aweme_id?: string };

  return {
    postUrl: "https://www.tiktok.com/@someone/video/7682751263435525398",
    postExternalId: first?.aweme_id ?? "7682751263435525398",
    credentials,
    ...overrides,
  };
}

describe("the connector's declared economics", () => {
  it("is TikTok fetched by ScrapeCreators, the second provider for that platform", () => {
    expect(scrapeCreatorsTikTok.platform.id).toBe(tikTokPlatformId);
    expect(scrapeCreatorsTikTok.provider.id).toBe(scrapeCreatorsProviderId);
    assertSourcesCanBeStored([scrapeCreatorsTikTok.platform.id]);
  });

  it("bills a request at the price the Reddit connector is priced at", () => {
    // One provider, one credit pack. This is not an assumption a connector may
    // make in general — SocialCrawl spends one credit on X and five on
    // LinkedIn through a single key — so it is measured and then pinned.
    expect(scrapeCreatorsTikTok.billableUnit).toBe("request");
    expect(scrapeCreatorsTikTok.pricePerUnitMicros).toBe(1880);
    expect(scrapeCreatorsTikTok.replyPricePerUnitMicros).toBe(1880);
  });

  it("is cheaper per video than the provider that already fetches TikTok", () => {
    // $0.063 a thousand against SocialCrawl's $0.27, which is the number
    // US-119 recommended building on.
    const perThousand =
      (scrapeCreatorsTikTok.pricePerUnitMicros / (scrapeCreatorsTikTok.postsPerUnit ?? 1)) * 1000;

    expect(Math.round(perThousand)).toBe(62_667);
  });
});

describe("the window a search asks for", () => {
  it("asks for everything when the monitor has no since", () => {
    expect(windowFor(undefined, now)).toBe("all-time");
  });

  it("picks the narrowest window that still covers since", () => {
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

    expect(windowFor(ago(0.5), now)).toBe("yesterday");
    expect(windowFor(ago(1), now)).toBe("yesterday");
    expect(windowFor(ago(2), now)).toBe("this-week");
    expect(windowFor(ago(7), now)).toBe("this-week");
    expect(windowFor(ago(8), now)).toBe("this-month");
    expect(windowFor(ago(31), now)).toBe("this-month");
    expect(windowFor(ago(32), now)).toBe("last-3-months");
    expect(windowFor(ago(92), now)).toBe("last-3-months");
    expect(windowFor(ago(93), now)).toBe("last-6-months");
    expect(windowFor(ago(184), now)).toBe("last-6-months");
  });

  it("falls back to everything when since is older than any window", () => {
    expect(windowFor(new Date(now.getTime() - 400 * 86_400_000), now)).toBe("all-time");
  });
});

describe("what a search sends", () => {
  it("asks for relevance ranking and never for date ordering", async () => {
    // US-119: sorted by date, `flaky tests` returns dog skin conditions and a
    // flaky croissant. This is the one line of the connector that decides
    // whether it finds anything, so it is pinned in both directions.
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    await source.search(request());

    const asked = new URL(stub.calls[0]?.url ?? "");
    expect(asked.pathname).toBe("/v1/tiktok/search/keyword");
    expect(asked.searchParams.get("sort_by")).toBe("relevance");
    expect(asked.searchParams.get("sort_by")).not.toBe("date-posted");
    expect(asked.searchParams.get("query")).toBe("flaky tests");
  });

  it("narrows the window to what the monitor asked for", async () => {
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date(now.getTime() - 3 * 86_400_000),
        },
      }),
    );

    expect(new URL(stub.calls[0]?.url ?? "").searchParams.get("date_posted")).toBe("this-week");
  });
});

describe("reading a captured page", () => {
  it("turns the whole page into posts", async () => {
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const result = await source.search(request());

    expect(itemsOf(wholePage).length).toBeGreaterThan(0);
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.unitsConsumed).toBe(1);
  });

  it("uses TikTok's own video id, which is what deduplicates against SocialCrawl", () => {
    const post = toCandidatePost(wholeVideo.item);
    const raw = (wholeVideo.item as { aweme_info: { aweme_id: string } }).aweme_info;

    expect(post?.externalId).toBe(raw.aweme_id);
    expect(post?.externalId).toMatch(/^\d{15,25}$/);
  });

  /**
   * What this proves, and what it does not.
   *
   * The two providers never returned the same video in a capture, so no test
   * can compare one record to another. What can be compared is the shape both
   * write into `posts.external_id` and `posts.url`: a numeric TikTok video id,
   * and `https://www.tiktok.com/@handle/video/<that id>`. SocialCrawl's own
   * fixture is read here rather than described, so this fails if either
   * provider moves.
   */
  it("writes the same id and URL shape SocialCrawl writes", () => {
    const socialCrawl = JSON.parse(
      readFileSync(
        new URL("../socialcrawl/tiktok-fixtures/search-keyword.json", import.meta.url),
        "utf8",
      ),
    ) as { body: { data: { items: readonly { post: { id: string; url: string } }[] } } };

    const theirs = socialCrawl.body.data.items[0]?.post;
    const ours = toCandidatePost(wholeVideo.item);

    /** `https://www.tiktok.com/@<handle>/video/<id>`, and the id it names. */
    const videoPage = /^https:\/\/www\.tiktok\.com\/@[^/?]+\/video\/(\d{15,25})$/;

    expect(theirs?.id).toMatch(/^\d{15,25}$/);
    expect(ours?.externalId).toMatch(/^\d{15,25}$/);

    expect(videoPage.exec(theirs?.url ?? "")?.[1]).toBe(theirs?.id);
    expect(videoPage.exec(ours?.url ?? "")?.[1]).toBe(ours?.externalId);
  });

  it("strips the share tracking off a post URL", () => {
    const raw = (wholeVideo.item as { aweme_info: { share_url: string } }).aweme_info.share_url;

    // The capture proved this matters rather than being tidiness: the
    // provider's own transcript endpoint refuses the URL until it is stripped.
    expect(raw).toContain("?");
    expect(toCandidatePost(wholeVideo.item)?.url).not.toContain("?");
    expect(cleanPostUrl("https://www.tiktok.com/@a/video/1")).toBe(
      "https://www.tiktok.com/@a/video/1",
    );
  });

  it("drops a record with no caption rather than storing silence", () => {
    const item = wholeVideo.item as { aweme_info: Record<string, unknown> };
    const silent = { aweme_info: { ...item.aweme_info, desc: "" } };

    expect(toCandidatePost(silent)).toBeUndefined();
  });

  it("drops a record with no id, no date or no URL rather than repairing it", () => {
    const item = wholeVideo.item as { aweme_info: Record<string, unknown> };

    expect(toCandidatePost({ aweme_info: { ...item.aweme_info, aweme_id: "" } })).toBeUndefined();
    expect(toCandidatePost({ aweme_info: { ...item.aweme_info, create_time: 0 } })).toBeUndefined();
    expect(
      toCandidatePost({ aweme_info: { ...item.aweme_info, share_url: "", share_info: {} } }),
    ).toBeUndefined();
  });

  it("falls back to the URL inside share_info when the top-level one is empty", () => {
    // Both are in the captured record and they hold the same address. The
    // fallback exists because only one of the two is documented, and the
    // capture found both.
    const item = wholeVideo.item as {
      aweme_info: Record<string, unknown> & { share_url: string };
    };

    const moved = {
      aweme_info: {
        ...item.aweme_info,
        share_url: "",
        share_info: { share_url: item.aweme_info.share_url },
      },
    };

    expect(toCandidatePost(moved)?.url).toBe(toCandidatePost(wholeVideo.item)?.url);
  });

  it("reports the reply count the platform gave, and nothing when it gave none", () => {
    const item = wholeVideo.item as { aweme_info: Record<string, unknown> };
    const stats = item.aweme_info.statistics as { comment_count: number };

    expect(toCandidatePost(wholeVideo.item)?.replyCount).toBe(stats.comment_count);
    expect(
      toCandidatePost({ aweme_info: { ...item.aweme_info, statistics: {} } })?.replyCount,
    ).toBeUndefined();
  });
});

describe("the since cut, which is ours to make", () => {
  it("drops posts at or before since", async () => {
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const all = await source.search(request());
    const newest = all.posts.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));

    const later = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: newest.postedAt } }),
    );

    expect(all.posts.length).toBeGreaterThan(0);
    expect(later.posts).toHaveLength(0);
    // The credit was still spent. A page filtered to nothing is not a free one.
    expect(later.unitsConsumed).toBe(1);
  });

  /**
   * The rule `reddit.ts` has and this connector must not.
   *
   * Relevance ranking means a page holds old and new videos mixed, so a page
   * whose every video is older than `since` says nothing about the next page.
   * Stopping there would lose whatever the following page held.
   */
  it("does not stop paging because a page is entirely older than since", async () => {
    const page = wholePage.body as Record<string, unknown>;
    const withCursor: Captured = {
      httpStatus: 200,
      body: { ...page, cursor: 30, has_more: 1 },
    };

    const stub = provider([withCursor]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: now } }),
    );

    expect(result.posts).toHaveLength(0);
    expect(result.next.status).toBe("ready");
  });

  it("is out of date order, which is why that rule cannot exist here", async () => {
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const { posts } = await source.search(request());
    const times = posts.map((post) => post.postedAt.getTime());
    const descending = times.every(
      (value, index) => index === 0 || (times[index - 1] ?? value) >= value,
    );

    expect(posts.length).toBeGreaterThan(2);
    expect(descending).toBe(false);
  });
});

describe("paging", () => {
  it("offers no cursor when the provider says there is no more", async () => {
    // The captured page ends `cursor: null, has_more: 0`.
    const stub = provider([wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    expect((await source.search(request())).next.status).toBe("done");
  });

  it("follows the numeric cursor the provider sends", async () => {
    const page = wholePage.body as Record<string, unknown>;
    const first: Captured = { httpStatus: 200, body: { ...page, cursor: 30, has_more: 1 } };

    const stub = provider([first, wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    expect(one.next.status).toBe("ready");

    await source.search(request({ cursor: (one.next as { cursor: string }).cursor }));
    expect(new URL(stub.calls[1]?.url ?? "").searchParams.get("cursor")).toBe("30");
  });

  it("treats a page that repeats an earlier one as ordinary, not as an error", async () => {
    // Seven of thirty on one capture run, none on another, and the provider
    // says TikTok may return duplicates. Deduplication is `posts`' job.
    const page = wholePage.body as Record<string, unknown>;
    const first: Captured = { httpStatus: 200, body: { ...page, cursor: 30, has_more: 1 } };

    const stub = provider([first, wholePage]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    const two = await source.search(request({ cursor: (one.next as { cursor: string }).cursor }));

    expect(two.posts.map((post) => post.externalId)).toEqual(
      one.posts.map((post) => post.externalId),
    );
  });

  it("stops after the pages one query is allowed", async () => {
    const page = wholePage.body as Record<string, unknown>;
    const endless: Captured = { httpStatus: 200, body: { ...page, cursor: 30, has_more: 1 } };

    const stub = provider([endless]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const one = await source.search(request());
    const two = await source.search(request({ cursor: (one.next as { cursor: string }).cursor }));

    // One query, two pages, and then there is nowhere left to go.
    expect(two.next.status).toBe("done");
  });
});

describe("comments", () => {
  it("reads a captured page into replies", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.itemsReturned).toBe(commentsOf(comments).length);
    expect(result.replies.length).toBeGreaterThan(0);
    expect(result.unitsConsumed).toBe(1);
  });

  it("asks with the share tracking stripped off the video URL", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    await source.fetchReplies(
      replyRequest({ postUrl: "https://www.tiktok.com/@a/video/1?_r=1&u_code=x" }),
    );

    expect(new URL(stub.calls[0]?.url ?? "").searchParams.get("url")).toBe(
      "https://www.tiktok.com/@a/video/1",
    );
  });

  it("builds TikTok's own comment link rather than reading a field that is sometimes empty", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    for (const reply of replies) {
      expect(reply.url).toContain("?cid=");
      expect(reply.url.startsWith("https://www.tiktok.com/@")).toBe(true);
    }
  });

  it("drops a comment that says it belongs to another post", () => {
    const first = commentsOf(comments)[0] as Record<string, unknown>;

    expect(
      toCandidateReply(first, {
        parentPostExternalId: "a-different-post",
        position: 0,
        postUrl: "https://www.tiktok.com/@a/video/1",
      }),
    ).toBeUndefined();
  });

  it("keeps the provider's own position, gaps and all", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest({ positionOffset: 40 }));

    expect(replies[0]?.threadPosition).toBe(40);
  });

  it("cuts on the thread's own window, not the poll's", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const all = await source.fetchReplies(replyRequest());
    const newest = all.replies.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));

    const later = await source.fetchReplies(replyRequest({ since: newest.postedAt }));

    expect(later.replies).toHaveLength(0);
    // Still billed, and still counted: the caller must not read an empty page
    // as a free one.
    expect(later.itemsReturned).toBe(all.itemsReturned);
    expect(later.unitsConsumed).toBe(1);
  });

  /**
   * A thread is partial whenever a comment claims replies we did not read.
   *
   * The captured page's eleven comments claimed 4, 49, 22, 47, 10, 4, 12 and 1
   * replies between them, and this connector reads none of them.
   */
  it("says the thread is partial when comments carry unread replies", async () => {
    const stub = provider([comments]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    expect((await source.fetchReplies(replyRequest())).partial).toBe(true);
  });

  it("does not call a thread complete merely because the cursor ran out", async () => {
    const body = comments.body as Record<string, unknown>;
    const answered: Captured = {
      httpStatus: 200,
      body: {
        ...body,
        has_more: 0,
        cursor: null,
        comments: (body.comments as Record<string, unknown>[]).map((comment) => ({
          ...comment,
          reply_comment_total: 0,
          reply_comment: [],
          thread_has_more: false,
        })),
      },
    };

    const stub = provider([answered]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));
    const result = await source.fetchReplies(replyRequest());

    expect(result.next.status).toBe("done");
    expect(result.partial).toBe(false);
  });
});

describe("credentials", () => {
  it("refuses an empty key without asking the provider", async () => {
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(provider([]).fetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your ScrapeCreators API key.",
    });
  });

  it("reads the provider's own refusal back to the person", async () => {
    const stub = provider([credentialsRejected]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
    expect(check.valid === false && check.reason).toContain("ScrapeCreators rejected the API key");
  });

  it("accepts the key the provider let past authentication", async () => {
    // The probe is a search with no query: the provider complains about the
    // missing parameter, which means the key got that far. The captured answer
    // charged nothing.
    const stub = provider([credentialsAccepted]);
    const source = new ScrapeCreatorsTikTokSource(runtimeWith(stub.fetch));

    expect(await source.validateCredentials(credentials)).toEqual({ valid: true });
    expect((credentialsAccepted.body as { credits_charged: number }).credits_charged).toBe(0);
  });
});
