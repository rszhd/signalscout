/**
 * The SocialCrawl TikTok connector, driven against payloads captured from a
 * live account by `tiktok-fixtures/capture.mjs` on 2026-09-06.
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
import { unreachableFetch } from "../../../testing/network.js";
import { tikTokPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { socialCrawlProviderId } from "./provider.js";
import {
  commentLink,
  SocialCrawlTikTokSource,
  socialCrawlTikTok,
  toCandidatePost,
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

const search = fixture("search-keyword");
const searchPage2 = fixture("search-page-2");
const comments = fixture("comments-page-1");
const commentsPage2 = fixture("comments-page-2");
const credentialsRejected = fixture("credentials-rejected");

function itemsOf(captured: Captured): readonly unknown[] {
  return (captured.body as { data?: { items?: readonly unknown[] } }).data?.items ?? [];
}

function socialCrawl(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: { url: string }[] = [];

  const fetchStub: typeof globalThis.fetch = (input) => {
    calls.push({ url: String(input) });
    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as Captured;

    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.httpStatus }));
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => new Date("2026-09-06T13:00:00.000Z"),
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "tiktok-test" }),
  };
}

const credentials = { apiKey: "sc_a-socialcrawl-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: ["flaky tests"], channels: [] }, credentials, ...overrides };
}

describe("the connector's declared economics", () => {
  it("is TikTok fetched by SocialCrawl, the fourth platform on that key", () => {
    expect(socialCrawlTikTok.platform.id).toBe(tikTokPlatformId);
    expect(socialCrawlTikTok.provider.id).toBe(socialCrawlProviderId);
    assertSourcesCanBeStored([socialCrawlTikTok.platform.id]);
  });

  it("bills one credit a request, for a search and for a comment page alike", () => {
    expect(socialCrawlTikTok.billableUnit).toBe("request");
    expect(socialCrawlTikTok.pricePerUnitMicros).toBe(8118);
    expect(socialCrawlTikTok.replyPricePerUnitMicros).toBe(8118);
  });

  it("declares that it reads replies, on the connector the registry builds", () => {
    const built = new SocialCrawlTikTokSource(runtimeWith(unreachableFetch));

    expect(socialCrawlTikTok.canFetchReplies).toBe(true);
    expect(built.canFetchReplies).toBe(true);
    expect(typeof built.fetchReplies).toBe("function");
  });
});

describe("one video", () => {
  it("keeps the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(itemsOf(search)[0]);

    expect(post?.externalId).toBe("7637566893792005389");
    expect(post?.url).toContain("tiktok.com/");
    expect(post?.text.length).toBeGreaterThan(0);
    expect(post?.postedAt).toBeInstanceOf(Date);
  });

  /**
   * A TikTok video has no title and no description — the caption is the only
   * text it carries, which is why this platform's leads are in the comments.
   * A video without one buys a classification to score silence.
   */
  it("drops a video with no caption, rather than storing an empty one", () => {
    const real = (itemsOf(search)[0] as { post: Record<string, unknown> }).post;

    for (const missing of ["id", "url", "published_at", "content"]) {
      const { [missing]: _gone, ...rest } = real;
      expect(toCandidatePost({ post: rest })).toBeUndefined();
    }
  });

  it("carries the comment count, which is what decides whether a thread opens", () => {
    const counted = itemsOf(search)
      .map((item) => toCandidatePost(item))
      .filter((post) => post?.replyCount !== undefined);

    expect(counted.length).toBeGreaterThan(0);
  });
});

describe("paging a search", () => {
  it("follows the cursor to a second page", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([search, searchPage2]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    await source.search(request({ cursor: first.next.cursor }));

    expect(calls[0]?.url).toContain("/v1/tiktok/search");
    expect(calls[1]?.url).toContain("cursor=");
  });

  it("stops after the page limit, however much more is offered", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    if (first.next.status !== "ready") throw new Error("expected a cursor");

    expect((await source.search(request({ cursor: first.next.cursor }))).next.status).toBe("done");
  });

  it("moves to the monitor's next query rather than finishing on the first", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    let cursor: string | undefined;
    for (let call = 0; call < 2; call += 1) {
      const result = await source.search(
        request({ query: { queries: ["one", "two"], channels: [] }, cursor }),
      );
      if (result.next.status !== "ready") throw new Error("expected another input");
      cursor = result.next.cursor;
    }

    // Two pages of the first query, then the second query rather than done.
    expect(cursor).toContain("1|0");
  });

  it("refuses a cursor it did not issue", async () => {
    const source = new SocialCrawlTikTokSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-ours" }))).rejects.toThrow(
      "was not issued by this source",
    );
  });

  it("cuts on the monitor's window, and bills anyway", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const result = await source.search(
      request({
        query: {
          queries: ["flaky tests"],
          channels: [],
          since: new Date("2030-01-01T00:00:00.000Z"),
        },
      }),
    );

    expect(result.posts).toEqual([]);
    // The credit was spent on the request, not on what survived.
    expect(result.unitsConsumed).toBe(1);
  });
});

describe("reading the comments under a video", () => {
  const replyRequest = {
    postUrl: "https://www.tiktok.com/@someone/video/6756744559671168262",
    postExternalId: "6756744559671168262",
    credentials,
  };

  it("asks the comments endpoint for that video", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    await source.fetchReplies(replyRequest);

    expect(calls[0]?.url).toContain("/v1/tiktok/post/comments");
    expect(calls[0]?.url).toContain(encodeURIComponent(replyRequest.postUrl));
  });

  /**
   * The shared parser reads this without a line of TikTok's own, which is the
   * claim US-020 proved for X and YouTube and this extends to a fourth
   * platform: the provider gives every comment endpoint one shape.
   */
  it("parses a page through the shared parser, linked to its video", async () => {
    const { fetch: fetchStub } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.length).toBeGreaterThan(30);
    expect(
      result.replies.every((reply) => reply.parentPostExternalId === replyRequest.postExternalId),
    ).toBe(true);
    expect(result.replies.every((reply) => reply.text.length > 0)).toBe(true);
    expect(result.unitsConsumed).toBe(1);
  });

  /**
   * The comment link, against the one example TikTok itself produced.
   *
   * This is the anchor of the whole format and it is why the string below is
   * written out rather than computed. TikTok sent the owner this link in a
   * comment notification on 2026-09-06:
   *
   *     .../video/7179206402840202522?cid=NzE3OTk1NzM4NDU1MDcyODQ3NA
   *
   * and `NzE3OTk1NzM4NDU1MDcyODQ3NA` decodes to `7179957384550728474`, the
   * comment's own id. So `cid` is the decimal id in URL-safe base64 with the
   * padding removed. A test that encoded and decoded with the same function
   * would prove our arithmetic and nothing about TikTok; this one fails if the
   * encoding ever stops reproducing the platform's own string.
   *
   * The predecessor is the reason for the care. This connector invented
   * `?comment_id=`, argued it could only help, shipped it through a capture and
   * two live polls, and the owner opened one and got the video.
   */
  it("builds the comment link TikTok itself produced", () => {
    expect(
      commentLink(
        "https://www.tiktok.com/@fendymojo/video/7179206402840202522",
        "7179957384550728474",
      ),
    ).toBe(
      "https://www.tiktok.com/@fendymojo/video/7179206402840202522?cid=NzE3OTk1NzM4NDU1MDcyODQ3NA",
    );
  });

  it("keeps a query string the video URL already had", () => {
    expect(commentLink("https://www.tiktok.com/@a/video/1?lang=en", "7179957384550728474")).toBe(
      "https://www.tiktok.com/@a/video/1?lang=en&cid=NzE3OTk1NzM4NDU1MDcyODQ3NA",
    );
  });

  it("links every comment to itself, not to the video", async () => {
    const { fetch: fetchStub } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(
      result.replies.every((reply) => reply.url.startsWith(`${replyRequest.postUrl}?cid=`)),
    ).toBe(true);
    // The id is carried, so two comments under one video do not share a link.
    expect(new Set(result.replies.map((reply) => reply.url)).size).toBe(result.replies.length);
    // The invented parameter is gone and must not come back.
    expect(result.replies.every((reply) => !reply.url.includes("comment_id"))).toBe(true);
  });

  it("drops what was said before the window, testing every row", async () => {
    const { fetch: fetchStub } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const all = await source.fetchReplies(replyRequest);
    const since = new Date("2020-01-01T00:00:00.000Z");
    const recent = await source.fetchReplies({ ...replyRequest, since });

    expect(recent.replies.length).toBeLessThanOrEqual(all.replies.length);
    expect(recent.replies.every((reply) => reply.postedAt > since)).toBe(true);
  });

  it("reports partial while the provider offers another page", async () => {
    const { fetch: fetchStub } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.next.status).toBe("ready");
    expect(result.partial).toBe(true);
  });

  it("reports done on the last page", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsPage2]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies({ ...replyRequest, cursor: "page-2" });

    expect(result.next).toEqual({ status: "done" });
    expect(result.partial).toBe(false);
  });

  /**
   * What US-044 measured and what a person choosing this platform needs to
   * know. A TikTok comment is short — median 19 characters on the captured
   * thread — and the platform's own note says the lead is in the comments, so
   * a reader who saw only that sentence would expect more text than there is.
   *
   * This is not a rule the connector enforces. It is the measurement pinned
   * where somebody proposing a TikTok monitor will meet it.
   */
  it("returns comments that are mostly very short, which is the platform", async () => {
    const { fetch: fetchStub } = socialCrawl([comments]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    const { replies } = await source.fetchReplies(replyRequest);
    const lengths = replies.map((reply) => reply.text.length).sort((left, right) => left - right);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;

    expect(median).toBeLessThan(40);
  });
});

describe("a key the provider refuses", () => {
  it("is a refusal a person can act on, not a thrown error", async () => {
    const { fetch: fetchStub } = socialCrawl([credentialsRejected]);
    const source = new SocialCrawlTikTokSource(runtimeWith(fetchStub));

    expect((await source.validateCredentials(credentials)).valid).toBe(false);
  });

  it("refuses an empty key without asking the provider", async () => {
    const source = new SocialCrawlTikTokSource(runtimeWith(unreachableFetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });
});
