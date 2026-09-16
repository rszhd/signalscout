/**
 * The SocialCrawl Reddit connector, driven against payloads captured from a
 * live account by `reddit-fixtures/capture.mjs` on 2026-09-06.
 *
 * Nothing here reaches the network. docs/testing.md, *No test spends money*.
 *
 * The literals were read out of the fixtures by eye. Re-running the capture
 * collects different posts and will change them; that is a deliberate edit to
 * make at the same time, not a reason to derive them from the code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { unreachableFetch } from "../../../testing/network.js";
import { redditPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { ReplyRequest, SearchRequest, SourceRuntime } from "../../types.js";
import { socialCrawlProviderId } from "./provider.js";
import { flatten, SocialCrawlRedditSource, socialCrawlReddit, toCandidatePost } from "./reddit.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./reddit-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const keywordSearch = fixture("search-keyword");
const keywordPage2 = fixture("search-keyword-page-2");
const subredditPosts = fixture("subreddit-posts");
const scopedSearch = fixture("subreddit-search");
const credentialsRejected = fixture("credentials-rejected");
/** The whole nested thread, captured on 2026-09-17 by US-159. */
const thread = fixture("comments-thread");

function itemsOf(captured: Captured): readonly unknown[] {
  return (captured.body as { data?: { items?: readonly unknown[] } }).data?.items ?? [];
}

interface Call {
  readonly url: string;
}

function socialCrawl(replies: readonly Captured[]) {
  const queue = [...replies];
  const calls: Call[] = [];

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
    now: () => new Date("2026-09-06T11:00:00.000Z"),
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "sc-reddit-test" }),
  };
}

const credentials = { apiKey: "sc_a-socialcrawl-key" };

function request(query: Partial<SearchRequest["query"]>, rest: Partial<SearchRequest> = {}) {
  return {
    query: { queries: [], channels: [], ...query },
    credentials,
    ...rest,
  } as SearchRequest;
}

describe("the connector's declared economics", () => {
  it("is Reddit fetched by SocialCrawl, the third provider for it", () => {
    expect(socialCrawlReddit.platform.id).toBe(redditPlatformId);
    expect(socialCrawlReddit.provider.id).toBe(socialCrawlProviderId);
    assertSourcesCanBeStored([socialCrawlReddit.platform.id]);
  });

  it("costs 4.3 times a ScrapeCreators request, which precision has to pay for", () => {
    expect(socialCrawlReddit.billableUnit).toBe("request");
    expect(socialCrawlReddit.pricePerUnitMicros).toBe(8118);
  });

  /**
   * Five credits a call against ScrapeCreators' one, and the monitor form
   * reads the price from here so a person is told before they tick the box.
   */
  it("reads replies, and prices them at five times a search", () => {
    const built = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    expect(socialCrawlReddit.canFetchReplies).toBe(true);
    expect(built.canFetchReplies).toBe(true);
    expect(socialCrawlReddit.replyPricePerUnitMicros).toBe(5 * 8118);
    expect(built.fetchReplies).toBeTypeOf("function");
  });
});

/**
 * The measurement this connector exists for.
 *
 * `flaky tests` across all of Reddit returned 25 posts from r/TIdaL,
 * r/RedditLaqueristaSwap, r/Euphoria_HBO, r/AskVet and r/snapmaker — "flaky"
 * describes a Bluetooth connection and a dog as readily as a test suite. The
 * same words inside r/softwaretesting returned 7, every one on topic.
 */
describe("which endpoint a monitor's answers reach", () => {
  it("searches inside the subreddit when a monitor names both", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([scopedSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    await source.search(request({ queries: ["flaky tests"], channels: ["softwaretesting"] }));

    expect(calls[0]?.url).toContain("/v1/reddit/subreddit/search");
    expect(calls[0]?.url).toContain("subreddit=softwaretesting");
    expect(calls[0]?.url).toContain("query=flaky+tests");
  });

  it("does not also sweep the subreddit, which would buy back the noise", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([scopedSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    let cursor: string | undefined;
    for (let call = 0; call < 4; call += 1) {
      const result = await source.search(
        request({ queries: ["flaky tests"], channels: ["softwaretesting"] }, { cursor }),
      );
      if (result.next.status !== "ready") break;
      cursor = result.next.cursor;
    }

    expect(calls.every((call) => call.url.includes("/subreddit/search"))).toBe(true);
  });

  it("sweeps the subreddit when a monitor names no query", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([subredditPosts]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    await source.search(request({ channels: ["softwaretesting"] }));

    expect(calls[0]?.url).toContain("/v1/reddit/subreddit?");
    expect(calls[0]?.url).not.toContain("query=");
  });

  /**
   * The noisy mode, and it runs only when there is nothing better. A monitor
   * that named no channel asked for a search across Reddit, so it gets one.
   */
  it("searches all of Reddit only when a monitor names no channel", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([keywordSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    await source.search(request({ queries: ["flaky tests"] }));

    expect(calls[0]?.url).toContain("/v1/reddit/search?");
  });

  it("finds nothing to do for a monitor that named neither", async () => {
    const source = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    const result = await source.search(request({}));

    expect(result).toEqual({ posts: [], unitsConsumed: 0, next: { status: "done" } });
  });

  it("walks every pair a monitor's queries and channels make", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([scopedSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));
    const query = { queries: ["flaky tests", "brittle selectors"], channels: ["a", "b"] };

    let cursor: string | undefined;
    const asked = new Set<string>();

    for (let call = 0; call < 12; call += 1) {
      const result = await source.search(request(query, { cursor }));
      asked.add(calls[calls.length - 1]?.url ?? "");
      if (result.next.status !== "ready") break;
      cursor = result.next.cursor;
    }

    // Two queries by two subreddits is four pairs, however many pages each.
    expect(new Set([...asked].map((url) => url.replace(/&cursor=[^&]*/, ""))).size).toBe(4);
  });
});

describe("one post", () => {
  it("keeps the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(itemsOf(scopedSearch)[0]);

    expect(post?.channel).toBe("softwaretesting");
    expect(post?.url).toContain("reddit.com");
    expect(post?.text.length).toBeGreaterThan(0);
    expect(post?.postedAt).toBeInstanceOf(Date);
  });

  /**
   * Deduplication is keyed by `(source, external_id)`, and the other two
   * Reddit connectors both report Reddit's `t3_` fullname. This provider gives
   * the bare id, so the prefix is added — otherwise one provider's copy of a
   * post would never match another's and the same conversation would be
   * classified and billed twice.
   */
  it("rebuilds Reddit's own t3_ fullname, so two providers agree about a post", () => {
    for (const item of itemsOf(keywordSearch)) {
      expect(toCandidatePost(item)?.externalId).toMatch(/^t3_[a-z0-9]+$/);
    }
  });

  it("drops a record missing an id, a url, a date or words", () => {
    const real = (itemsOf(scopedSearch)[0] as { post: Record<string, unknown> }).post;

    for (const missing of ["id", "url", "published_at", "content"]) {
      const { [missing]: _gone, ...rest } = real;
      expect(toCandidatePost({ post: rest })).toBeUndefined();
    }
  });
});

describe("paging", () => {
  it("follows the cursor to a second page of the same input", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([keywordSearch, keywordPage2]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const first = await source.search(request({ queries: ["flaky tests"] }));
    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    await source.search(request({ queries: ["flaky tests"] }, { cursor: first.next.cursor }));

    expect(calls[1]?.url).toContain("cursor=");
  });

  it("stops after the page limit, however much more is offered", async () => {
    const { fetch: fetchStub } = socialCrawl([keywordSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const first = await source.search(request({ queries: ["flaky tests"] }));
    if (first.next.status !== "ready") throw new Error("expected a cursor");

    const second = await source.search(
      request({ queries: ["flaky tests"] }, { cursor: first.next.cursor }),
    );

    expect(second.next.status).toBe("done");
  });

  it("refuses a cursor it did not issue", async () => {
    const source = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    await expect(
      source.search(request({ queries: ["x"] }, { cursor: "not-ours" })),
    ).rejects.toThrow("was not issued by this source");
  });

  it("cuts on the monitor's window", async () => {
    const { fetch: fetchStub } = socialCrawl([scopedSearch]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const result = await source.search(
      request({
        queries: ["flaky tests"],
        channels: ["softwaretesting"],
        since: new Date("2030-01-01T00:00:00.000Z"),
      }),
    );

    expect(result.posts).toEqual([]);
    // Billed anyway. The credit was spent on the request, not on what survived.
    expect(result.unitsConsumed).toBe(1);
  });
});

describe("a key the provider refuses", () => {
  it("is a refusal a person can act on, not a thrown error", async () => {
    const { fetch: fetchStub } = socialCrawl([credentialsRejected]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    expect((await source.validateCredentials(credentials)).valid).toBe(false);
  });

  it("refuses an empty key without asking the provider", async () => {
    const source = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });
});

/**
 * The thread this connector buys for five credits. US-159.
 *
 * Captured on 2026-09-17 against a post claiming 34 comments, and it returned
 * all 34 — eight at the top and the rest nested five levels deep inside
 * `replies` arrays, with no cursor.
 */
describe("the whole thread under one post", () => {
  const postId = "1ulc2gz";
  const postUrl =
    "https://www.reddit.com/r/softwaretesting/comments/1ulc2gz/mobile_qa_engineers_how_long_would_this_test_take/";

  function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
    return { postUrl, postExternalId: postId, credentials, ...overrides };
  }

  /**
   * The measurement the five credits are justified by, asserted rather than
   * quoted. ScrapeCreators has been measured stopping at 43 of 95 comments
   * while reporting itself finished; this answer holds everything.
   */
  it("answers with a nested tree, not a page", () => {
    const top = itemsOf(thread);

    expect(top).toHaveLength(8);
    expect(flatten(top)).toHaveLength(34);
    expect((thread.body as { data: { truncated: boolean } }).data.truncated).toBe(false);
    expect(
      (thread.body as { pagination: { next_cursor: null } }).pagination.next_cursor,
    ).toBeNull();
  });

  /**
   * 34 arrived and 33 are stored. One comment, `ow825zg`, carries an empty
   * `text` while claiming not to be deleted — an image-only comment, as far as
   * this endpoint shows. The shared parser drops it rather than storing
   * silence for the classifier to score, and `itemsReturned` still counts it,
   * because the provider sent it and the next walk's positions must account
   * for it.
   */
  it("reads the whole thread for one call of five credits", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(stub.calls).toHaveLength(1);
    expect(new URL(stub.calls[0]?.url ?? "").pathname).toBe("/v1/reddit/post/comments");
    expect(result.replies).toHaveLength(33);
    expect(result.itemsReturned).toBe(34);
    expect(result.unitsConsumed).toBe(5);
  });

  /**
   * `itemsReturned` counts the flattened tree and not `data.items`. A caller
   * told "eight" would start the next walk's positions 26 places too low.
   */
  it("counts the comments the provider sent, not the branches it sent them in", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.itemsReturned).not.toBe(itemsOf(thread).length);
    expect(result.itemsReturned).toBe(34);
  });

  it("keeps the thread's shape in parent ids rather than in nesting", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    const ids = new Set(replies.map((reply) => reply.externalId));
    const nested = replies.filter((reply) => reply.parentReplyExternalId !== undefined);

    // 33 stored, 8 of them at the top of the thread.
    expect(nested.length).toBe(33 - 8);
    expect(replies.every((reply) => reply.parentPostExternalId === postId)).toBe(true);

    /**
     * Every nested reply's parent came back in the same call, except one.
     *
     * `ow8oido` answers `ow825zg`, the comment with no words, which the parser
     * drops — so it is stored naming a parent this instance holds no row for.
     * That is the honest outcome and not a fault to repair: the parent had no
     * words to give the classifier as context either way, and the post above
     * it is still stored and still linked. Inventing a row for it, or hiding
     * the link, would lose a real reply to make a set look tidy.
     */
    const orphans = nested.filter((reply) => !ids.has(reply.parentReplyExternalId as string));

    expect(orphans.map((reply) => reply.externalId)).toEqual(["ow8oido"]);
  });

  /**
   * US-020 measured `author.username` null on this platform and filled on X,
   * and wrote author presence down as a per-platform fact. This thread fills
   * it on every comment, so the fact is per-thread or it has changed — either
   * way the parser requires nothing it may not get.
   */
  it("carries an author, a link and a date on every comment", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest());

    expect(replies.every((reply) => reply.author !== undefined)).toBe(true);
    expect(replies.every((reply) => reply.url.includes("/comment/"))).toBe(true);
    expect(replies.every((reply) => reply.postedAt.getTime() > 0)).toBe(true);
  });

  it("walks the tree depth first, so a reply follows the words it answers", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const { replies } = await source.fetchReplies(replyRequest({ positionOffset: 10 }));

    expect(replies[0]?.threadPosition).toBe(10);
    expect(replies[1]?.parentReplyExternalId).toBe(replies[0]?.externalId);
    // 34 positions were issued from 10; the last stored reply is the 34th,
    // and the gap at 33 is the comment with no words.
    expect(replies.at(-1)?.threadPosition).toBe(43);
  });

  it("believes the provider when it says nothing was left behind", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.partial).toBe(false);
    expect(result.next.status).toBe("done");
  });

  it("records a truncated answer as partial, whatever the cursor says", async () => {
    const body = thread.body as { data: Record<string, unknown> };
    const cut = {
      httpStatus: 200,
      body: { ...body, data: { ...body.data, truncated: true } },
    };

    const stub = socialCrawl([cut]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const result = await source.fetchReplies(replyRequest());

    expect(result.partial).toBe(true);
    expect(result.next.status).toBe("done");
  });

  /**
   * A tree is not in date order — a fresh reply hangs under an old comment —
   * so the window is a filter over every row and never a stop.
   */
  it("cuts on the thread's own window", async () => {
    const stub = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(stub.fetch));

    const all = await source.fetchReplies(replyRequest());
    const newest = all.replies.reduce((a, b) => (a.postedAt > b.postedAt ? a : b));

    const later = await source.fetchReplies(replyRequest({ since: newest.postedAt }));

    expect(later.replies).toHaveLength(0);
    // Still billed, and still counted: an empty page is not a free one.
    expect(later.itemsReturned).toBe(34);
    expect(later.unitsConsumed).toBe(5);
  });

  it("ends a walk rather than following a cycle in somebody else's data", () => {
    const loop: Record<string, unknown> = { id: "a" };
    loop.replies = [loop];

    expect(flatten([loop]).length).toBeLessThan(25);
  });
});
