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
import {
  flattenThread,
  normaliseIds,
  SocialCrawlRedditSource,
  socialCrawlReddit,
  toCandidatePost,
} from "./reddit.js";

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
/** US-138: the whole tree under a post claiming 34 comments, captured 2026-09-15. */
const thread = fixture("comments");
const ledger = JSON.parse(
  readFileSync(new URL("./reddit-fixtures/ledger.json", import.meta.url), "utf8"),
) as { name: string; creditsUsed: number | null }[];

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
   * US-138. Five credits a call against the search's one, so the reply price
   * is declared on its own — the field that stops a fivefold overspend — and
   * the declaration reaches the built instance, which is what every screen
   * reads.
   */
  it("declares replies at five credits a call, on the definition and the instance", () => {
    const built = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    expect(socialCrawlReddit.canFetchReplies).toBe(true);
    expect(socialCrawlReddit.replyPricePerUnitMicros).toBe(5 * 8118);
    expect(built.canFetchReplies).toBe(true);
    expect(built.replyPricePerUnitMicros).toBe(5 * 8118);

    expect(ledger.find((entry) => entry.name === "comments")?.creditsUsed).toBe(5);
  });
});

/** The post the comments capture asked about, as `socialcrawl/reddit.ts` keys it. */
const threadPostId = "t3_1ulc2gz";
const threadUrl =
  "https://www.reddit.com/r/softwaretesting/comments/1ulc2gz/mobile_qa_engineers_how_long_would_this_test_take/";

function replyRequest(overrides: Partial<ReplyRequest> = {}): ReplyRequest {
  return { postUrl: threadUrl, postExternalId: threadPostId, credentials, ...overrides };
}

describe("the thread under a post", () => {
  it("arrives whole in one call: 34 comments for 34 claimed, nested under replies", () => {
    const rows = flattenThread(itemsOf(thread));

    expect(itemsOf(thread)).toHaveLength(8);
    expect(rows).toHaveLength(34);
    // Flattened rows carry no subtree of their own, so nothing is stored twice.
    expect(rows.every((row) => !("replies" in row))).toBe(true);
    // Depth first, in the provider's order: the first top-level comment's
    // child follows it directly.
    expect(rows[0]?.id).toBe("ov3sslq");
    expect(rows[1]?.parent_id).toBe("ov3sslq");
  });

  it("asks by post URL, five credits, and reports one unit for the call", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest());

    const asked = new URL(calls[0]?.url ?? "");
    expect(asked.pathname).toBe("/v1/reddit/post/comments");
    expect(asked.searchParams.get("url")).toBe(threadUrl);
    expect(result.itemsReturned).toBe(34);
    // 33, not 34: one row is a removed comment the provider still lists, with
    // no text and no author, and the shared parser drops a comment with no
    // words rather than storing silence. It is still counted, and paid for.
    expect(result.replies).toHaveLength(33);
    expect(result.unitsConsumed).toBe(1);
  });

  it("drops the removed comment the provider lists with no text, and counts it", () => {
    const removed = flattenThread(itemsOf(thread)).filter((row) => row.text === null);

    expect(removed).toHaveLength(1);
    expect(removed[0]?.id).toBe("ow825zg");
  });

  it("reports nothing for a call the provider served from cache for free", async () => {
    const cached = {
      httpStatus: 200,
      body: { ...(thread.body as Record<string, unknown>), credits_used: 0, cached: true },
    };
    const { fetch: fetchStub } = socialCrawl([cached]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    expect((await source.fetchReplies(replyRequest())).unitsConsumed).toBe(0);
  });

  /**
   * The ids the other Reddit connectors already agree on. SocialCrawl sends
   * them bare; ScrapeCreators sends Reddit's fullname. Keyed by
   * `(source, external_id)`, the same comment through both must be one row.
   */
  it("keys a comment t1_ and its post t3_, so two providers store one row", async () => {
    const { fetch: fetchStub } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const { replies } = await source.fetchReplies(replyRequest());

    expect(replies[0]?.externalId).toBe("t1_ov3sslq");
    for (const reply of replies) {
      expect(reply.externalId.startsWith("t1_")).toBe(true);
      expect(reply.parentPostExternalId).toBe(threadPostId);
    }
  });

  it("hangs a top-level comment under the post and a nested one under its parent", async () => {
    const { fetch: fetchStub } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const { replies } = await source.fetchReplies(replyRequest());

    const topLevel = replies.filter((reply) => reply.parentReplyExternalId === undefined);
    const nested = replies.filter((reply) => reply.parentReplyExternalId !== undefined);
    expect(topLevel).toHaveLength(8);
    // 25 of the 26 nested rows: the removed one above is nested.
    expect(nested).toHaveLength(25);
    expect(replies[1]?.parentReplyExternalId).toBe("t1_ov3sslq");
  });

  it("normalises a bare id, a bare post id and a parent naming the post", () => {
    const top = normaliseIds({ id: "abc", post_id: "1ulc2gz", parent_id: "1ulc2gz" }, "1ulc2gz");
    expect(top).toEqual({ id: "t1_abc", post_id: "t3_1ulc2gz", parent_id: "t3_1ulc2gz" });

    const child = normaliseIds({ id: "def", post_id: "1ulc2gz", parent_id: "abc" }, "1ulc2gz");
    expect(child.parent_id).toBe("t1_abc");

    // Already a fullname: left alone rather than prefixed twice.
    expect(normaliseIds({ id: "t1_abc", post_id: "t3_1ulc2gz" }, "1ulc2gz").id).toBe("t1_abc");
  });

  it("reads the author, the provider's own link and the reply count", async () => {
    const { fetch: fetchStub } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const { replies } = await source.fetchReplies(replyRequest());
    const first = replies[0];

    expect(first?.author).toBe("redditor-2");
    expect(first?.url).toBe(
      "https://www.reddit.com/r/softwaretesting/comments/1ulc2gz/comment/ov3sslq/",
    );
    expect(first?.replyCount).toBe(1);
    expect(first?.threadPosition).toBe(0);
    expect(first?.text).toBe("30min to write, another 30 to debug and optimize");
  });

  it("drops a comment that says it belongs to another post", async () => {
    const body = thread.body as { data: { items: { comment: Record<string, unknown> }[] } };
    const foreign = {
      httpStatus: 200,
      body: {
        ...body,
        data: {
          ...body.data,
          items: body.data.items.map((item) => ({
            comment: { ...item.comment, post_id: "zzzzzzz", replies: [] },
          })),
        },
      },
    };
    const { fetch: fetchStub } = socialCrawl([foreign]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest());

    expect(result.replies).toHaveLength(0);
    expect(result.itemsReturned).toBe(8);
  });

  /**
   * Not in date order — a nested reply is newer than its parent by
   * construction and sits right after it — so every row is cut on its own.
   */
  it("cuts on the thread's window row by row, and never stops early", async () => {
    const { fetch: fetchStub } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const all = await source.fetchReplies(replyRequest());
    const dates = all.replies.map((reply) => reply.postedAt.getTime());
    expect(dates.every((value, index) => index === 0 || (dates[index - 1] ?? 0) >= value)).toBe(
      false,
    );

    const sorted = [...dates].sort((a, b) => a - b);
    const middle = new Date(sorted[17] as number);
    const later = await source.fetchReplies(replyRequest({ since: middle }));

    expect(later.replies.length).toBeGreaterThan(0);
    expect(later.replies.length).toBeLessThan(33);
    expect(later.replies.every((reply) => reply.postedAt > middle)).toBe(true);
    expect(later.itemsReturned).toBe(34);
  });

  it("calls the thread complete when the provider says it is not truncated and offers no cursor", async () => {
    const { fetch: fetchStub } = socialCrawl([thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest());

    expect(result.next.status).toBe("done");
    expect(result.partial).toBe(false);
  });

  it("calls it partial when the provider says truncated, or says nothing", async () => {
    const body = thread.body as { data: Record<string, unknown> };
    const truncated = {
      httpStatus: 200,
      body: { ...body, data: { ...body.data, truncated: true } },
    };
    const silent = {
      httpStatus: 200,
      body: { ...body, data: { ...body.data, truncated: undefined } },
    };

    const first = new SocialCrawlRedditSource(runtimeWith(socialCrawl([truncated]).fetch));
    const second = new SocialCrawlRedditSource(runtimeWith(socialCrawl([silent]).fetch));

    expect((await first.fetchReplies(replyRequest())).partial).toBe(true);
    expect((await second.fetchReplies(replyRequest())).partial).toBe(true);
  });

  it("follows a cursor when the provider offers one, and calls the thread partial", async () => {
    const body = thread.body as Record<string, unknown>;
    const paged = {
      httpStatus: 200,
      body: { ...body, pagination: { next_cursor: "more", has_more: true, page_size: 8 } },
    };
    const { fetch: fetchStub, calls } = socialCrawl([paged, thread]);
    const source = new SocialCrawlRedditSource(runtimeWith(fetchStub));

    const first = await source.fetchReplies(replyRequest());
    expect(first.next).toEqual({ status: "ready", cursor: "more" });
    expect(first.partial).toBe(true);

    await source.fetchReplies(replyRequest({ cursor: "more", positionOffset: 34 }));
    expect(new URL(calls[1]?.url ?? "").searchParams.get("cursor")).toBe("more");
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
