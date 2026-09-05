/**
 * The SocialCrawl YouTube connector, driven against payloads captured from a
 * live account by `youtube-fixtures/capture.mjs` on 2026-09-06.
 *
 * Nothing here reaches the network. The runtime's `fetch` replays the captured
 * files or is `unreachableFetch`, so a test that tried to search anything would
 * fail rather than spend a credit. docs/testing.md, *No test spends money*.
 *
 * The literals below were read out of the fixtures by eye. Re-running the
 * capture collects different videos and will change them; that is a deliberate
 * edit to make at the same time, not a reason to derive the expected values
 * from the code that produces them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { unreachableFetch } from "../../../testing/network.js";
import { youTubePlatformId } from "../../platforms.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { socialCrawlProviderId } from "./provider.js";
import {
  SocialCrawlYouTubeSource,
  socialCrawlYouTube,
  toCandidatePost,
  toCandidateReply,
} from "./youtube.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./youtube-fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

const searchPlain = fixture("search-plain") as Record<string, unknown>;
const searchWithExtras = fixture("search-with-extras") as Record<string, unknown>;
const searchPage2 = fixture("search-page-2") as Record<string, unknown>;
const searchNoResults = fixture("search-no-results") as Record<string, unknown>;
const comments = fixture("comments-newest") as Record<string, unknown>;
const credentialsRejected = fixture("credentials-rejected") as unknown;

const now = new Date("2026-09-06T05:00:00.000Z");

function itemsOf(body: Record<string, unknown>): readonly unknown[] {
  return (body.data as { items?: readonly unknown[] })?.items ?? [];
}

interface Call {
  readonly url: string;
  readonly apiKey: string | null;
}

/** A `fetch` that answers from the captured files, last entry repeating. */
function socialCrawl(replies: readonly { status: number; body: unknown }[]) {
  const queue = [...replies];
  const calls: Call[] = [];

  const fetchStub: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), apiKey: headers.get("x-api-key") });

    const reply = (queue.length === 1 ? queue[0] : queue.shift()) as {
      status: number;
      body: unknown;
    };

    return Promise.resolve(
      new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
        status: reply.status,
      }),
    );
  };

  return { fetch: fetchStub, calls };
}

function runtimeWith(fetchStub: typeof globalThis.fetch): SourceRuntime {
  return {
    fetch: fetchStub,
    now: () => now,
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "youtube-test" }),
  };
}

const credentials = { apiKey: "a-socialcrawl-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return { query: { queries: ["flaky tests"], channels: [] }, credentials, ...overrides };
}

describe("the connector's declared economics", () => {
  it("is YouTube fetched by SocialCrawl, on the key that fetches X", () => {
    expect(socialCrawlYouTube.platform.id).toBe(youTubePlatformId);
    expect(socialCrawlYouTube.provider.id).toBe(socialCrawlProviderId);
  });

  it("bills a request at one credit, the same as X and a fifth of LinkedIn's call", () => {
    expect(socialCrawlYouTube.billableUnit).toBe("request");
    expect(socialCrawlYouTube.pricePerUnitMicros).toBe(8118);
  });

  it("declares that it reads replies, on the connector the registry builds", () => {
    const built = new SocialCrawlYouTubeSource(runtimeWith(unreachableFetch));

    expect(socialCrawlYouTube.canFetchReplies).toBe(true);
    expect(built.canFetchReplies).toBe(true);
    expect(built.replyPricePerUnitMicros).toBe(8118);
    expect(typeof built.fetchReplies).toBe("function");
  });
});

describe("one search result", () => {
  it("keeps the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(itemsOf(searchWithExtras)[0]);

    expect(post?.externalId).toBe("8g7FvoRToGo");
    expect(post?.url).toBe("https://www.youtube.com/watch?v=8g7FvoRToGo");
    expect(post?.title).toContain("Avoid flaky end-to-end tests");
    expect(post?.postedAt).toEqual(new Date("2024-03-27T13:05:25.000Z"));
  });

  it("drops a record with no id, no url, no date or no words, rather than repairing it", () => {
    const real = (itemsOf(searchWithExtras)[0] as { post: Record<string, unknown> }).post;

    for (const missing of ["id", "url", "published_at", "content"]) {
      const { [missing]: _gone, ...rest } = real;
      expect(toCandidatePost({ post: rest })).toBeUndefined();
    }
  });
});

/**
 * The measurement that shapes this connector.
 *
 * Without `includeExtras=true` the provider derives a video's date from a
 * relative label — "2 years ago" — and says so in `ext.published_precision`.
 * Comparing the same 45 results both ways gave a median drift of 62 days and a
 * maximum of 283, against a documented "up to four months".
 */
describe("a date the provider will not stand behind", () => {
  it("is marked approximate when the provider says its precision is a year", () => {
    const plain = itemsOf(searchPlain).map((item) => toCandidatePost(item));
    const approximate = plain.filter((post) => post?.postedAtIsApproximate);

    expect(approximate.length).toBeGreaterThan(0);
  });

  it("is not marked when the exact instant was asked for", () => {
    const exact = itemsOf(searchWithExtras).map((item) => toCandidatePost(item));

    expect(exact.every((post) => post?.postedAtIsApproximate === undefined)).toBe(true);
  });

  it("always asks for the exact instant, because it costs the same", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([{ status: 200, body: searchPlain }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    await source.search(request());

    expect(calls[0]?.url).toContain("includeExtras=true");
  });

  /**
   * The rule this exists for. A video the provider dated as "2 years ago"
   * could have been published this week, so a `since` cut applied to it would
   * drop a fresh lead and nobody could tell that happened.
   */
  it("keeps a video whose date is approximate, rather than cutting on a guess", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: searchPlain }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    // A window that excludes every date in the fixture, exact or not.
    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: now } }),
    );

    const kept = result.posts;

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((post) => post.postedAtIsApproximate === true)).toBe(true);
  });

  it("cuts on a date it can trust", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: searchWithExtras }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.search(
      request({ query: { queries: ["flaky tests"], channels: [], since: now } }),
    );

    expect(result.posts).toEqual([]);
  });
});

describe("paging a search", () => {
  it("follows the provider's cursor to a second page", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([
      { status: 200, body: searchPlain },
      { status: 200, body: searchPage2 },
    ]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const first = await source.search(request());

    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    await source.search(request({ cursor: first.next.cursor }));

    expect(calls[1]?.url).toContain("cursor=");
  });

  it("stops after the page limit, however much more the provider offers", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: searchPlain }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    if (first.next.status !== "ready") throw new Error("expected a first cursor");

    const second = await source.search(request({ cursor: first.next.cursor }));

    // One query, two pages, and then done — not a third page.
    expect(second.next.status).toBe("done");
  });

  it("moves to the monitor's next query rather than finishing on the first", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: searchNoResults }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.search(
      request({ query: { queries: ["flaky tests", "brittle selectors"], channels: [] } }),
    );

    expect(result.next.status).toBe("ready");
  });

  it("refuses a cursor it did not issue", async () => {
    const source = new SocialCrawlYouTubeSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-ours" }))).rejects.toThrow(
      "was not issued by this source",
    );
  });
});

/**
 * A search that matches nothing is billed in full and does not come back
 * empty: a phrase that cannot occur returned twelve unrelated videos. Same as
 * LinkedIn, opposite of X.
 */
describe("a search that matches nothing", () => {
  it("still bills, and still returns videos", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: searchNoResults }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.search(request({ query: { queries: ["zzqx"], channels: [] } }));

    expect(result.unitsConsumed).toBe(1);
    expect(result.posts.length).toBeGreaterThan(0);
  });
});

describe("reading the comments under a video", () => {
  const replyRequest = {
    postUrl: "https://www.youtube.com/watch?v=8g7FvoRToGo",
    postExternalId: "8g7FvoRToGo",
    credentials,
  };

  it("asks the comments endpoint, newest first, for that video", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    await source.fetchReplies(replyRequest);

    expect(calls[0]?.url).toContain("/v1/youtube/video/comments");
    expect(calls[0]?.url).toContain("order=newest");
    expect(calls[0]?.apiKey).toBe(credentials.apiKey);
  });

  it("returns the whole page in one call", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    // 51 comments arrived; every one with an id, a body and a date is kept.
    expect(result.replies.length).toBeGreaterThan(40);
  });

  /**
   * The price is read from the answer, never counted here — and this fixture is
   * why that matters rather than being a nicety.
   *
   * The capture asked for this thread twice, and the second answer came back
   * flagged `cached: true` with `credits_used: 0`. So a connector that assumed
   * "one call, one credit" would have reported a charge the provider did not
   * make. The captured payload says zero and this asserts zero, because the
   * fixture is evidence about the provider and not about our expectations.
   *
   * A billed page reports 1. `ledger.json` beside the fixtures holds both.
   */
  it("bills what the provider says it billed, which was nothing for a cache hit", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const cached = await source.fetchReplies(replyRequest);

    expect(cached.unitsConsumed).toBe(0);

    const billed = { ...comments, credits_used: 1, cached: false };
    const { fetch: secondStub } = socialCrawl([{ status: 200, body: billed }]);
    const second = new SocialCrawlYouTubeSource(runtimeWith(secondStub));

    expect((await second.fetchReplies(replyRequest)).unitsConsumed).toBe(1);
  });

  it("links every comment to its video, and keeps an exact timestamp", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.every((reply) => reply.parentPostExternalId === "8g7FvoRToGo")).toBe(
      true,
    );
    // Not midnight. The provider gives a per-second instant on every comment,
    // which is what makes a date window possible at all here.
    expect(result.replies.some((reply) => reply.postedAt.getUTCHours() !== 0)).toBe(true);
  });

  it("builds a link to the comment, because the provider leaves the url null", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const [reply] = (await source.fetchReplies(replyRequest)).replies;

    expect(reply?.url).toContain("watch?v=8g7FvoRToGo");
    expect(reply?.url).toContain("lc=");
  });

  /**
   * The provider's own claim, and the one this connector rests on: rows arrive
   * newest-first on an exact timestamp, so a date window is a walk rather than
   * a whole-thread read. Measured over one full thread.
   */
  it("comes back newest first, which is what a date window rests on", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const { replies } = await source.fetchReplies(replyRequest);

    for (let index = 1; index < replies.length; index += 1) {
      const previous = replies[index - 1]?.postedAt.getTime() ?? 0;
      const current = replies[index]?.postedAt.getTime() ?? 0;
      expect(current).toBeLessThanOrEqual(previous);
    }
  });

  it("reports a finished thread as complete, because the provider agreed with itself", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: comments }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    // `has_more: false` and no cursor, on a thread whose count agreed.
    expect(result.next).toEqual({ status: "done" });
    expect(result.partial).toBe(false);
  });

  it("reports partial while the provider offers another page", async () => {
    const withMore = {
      ...comments,
      pagination: { next_cursor: "sc.more", has_more: true, page_size: 51 },
    };
    const { fetch: fetchStub } = socialCrawl([{ status: 200, body: withMore }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.next).toEqual({ status: "ready", cursor: "sc.more" });
    expect(result.partial).toBe(true);
  });

  it("tells a reply to a comment from a reply to the video", () => {
    const top = toCandidateReply(
      { comment: { id: "c1", text: "words", published_at: now.toISOString(), parent_id: "vid" } },
      "vid",
    );
    const nested = toCandidateReply(
      { comment: { id: "c2", text: "words", published_at: now.toISOString(), parent_id: "c1" } },
      "vid",
    );

    expect(top?.parentReplyExternalId).toBeUndefined();
    expect(nested?.parentReplyExternalId).toBe("c1");
  });
});

describe("a key the provider refuses", () => {
  it("is a refusal a person can act on, not a thrown error", async () => {
    const { fetch: fetchStub } = socialCrawl([{ status: 401, body: credentialsRejected }]);
    const source = new SocialCrawlYouTubeSource(runtimeWith(fetchStub));

    const check = await source.validateCredentials(credentials);

    expect(check.valid).toBe(false);
  });

  it("refuses an empty key without asking the provider", async () => {
    const source = new SocialCrawlYouTubeSource(runtimeWith(unreachableFetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });
});
