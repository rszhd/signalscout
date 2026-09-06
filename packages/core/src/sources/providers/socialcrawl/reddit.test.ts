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
import type { SearchRequest, SourceRuntime } from "../../types.js";
import { socialCrawlProviderId } from "./provider.js";
import { SocialCrawlRedditSource, socialCrawlReddit, toCandidatePost } from "./reddit.js";

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
   * Not an omission. Its comment endpoint works and costs 5 credits where
   * ScrapeCreators' costs 1 for the same thread, measured in US-020. A
   * deployment that wants Reddit replies uses the cheaper provider, and the
   * monitor form reads this declaration so a person is told rather than
   * finding out.
   */
  it("declares that it does not read replies, because the cheap provider does", () => {
    const built = new SocialCrawlRedditSource(runtimeWith(unreachableFetch));

    expect(socialCrawlReddit.canFetchReplies).toBe(false);
    expect(built.canFetchReplies).toBe(false);
    expect((built as { fetchReplies?: unknown }).fetchReplies).toBeUndefined();
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
