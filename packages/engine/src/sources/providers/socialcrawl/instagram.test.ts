/**
 * The SocialCrawl Instagram connector, driven against payloads captured from a
 * live account by `instagram-fixtures/capture.mjs` on 2026-09-06.
 *
 * Nothing here reaches the network. docs/testing.md, *No test spends money*.
 *
 * The literals were read out of the fixtures by eye. Re-running the capture
 * collects different reels and will change them; that is a deliberate edit to
 * make at the same time, not a reason to derive them from the code.
 *
 * Three of these cases exist because the capture contradicted the catalogue,
 * and each one goes red if the connector starts believing the documentation
 * again: the empty second page that still says `has_more`, the date window that
 * is mandatory rather than optional, and the two upstream surfaces behind one
 * endpoint.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../logger.js";
import { unreachableFetch } from "../../../testing/network.js";
import { instagramPlatformId } from "../../platforms.js";
import { assertSourcesCanBeStored } from "../../storage.js";
import type { SearchRequest, SourceRuntime } from "../../types.js";
import {
  commentLink,
  SocialCrawlInstagramSource,
  socialCrawlInstagram,
  toCandidatePost,
} from "./instagram.js";
import { socialCrawlProviderId } from "./provider.js";

interface Captured {
  readonly httpStatus: number;
  readonly body: unknown;
}

function fixture(name: string): Captured {
  return JSON.parse(
    readFileSync(new URL(`./instagram-fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Captured;
}

const search = fixture("search-consumer");
const searchPage2 = fixture("search-page-2");
const searchDated = fixture("search-dated");
const commentsRecent = fixture("comments-recent");
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
    logger: createLogger({ level: "silent", name: "instagram-test" }),
  };
}

const credentials = { apiKey: "sc_a-socialcrawl-key" };

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query: { queries: ["skincare for acne scars"], channels: [] },
    credentials,
    ...overrides,
  };
}

describe("the connector's declared economics", () => {
  it("is Instagram fetched by SocialCrawl, the fifth platform on that key", () => {
    expect(socialCrawlInstagram.platform.id).toBe(instagramPlatformId);
    expect(socialCrawlInstagram.provider.id).toBe(socialCrawlProviderId);
    assertSourcesCanBeStored([socialCrawlInstagram.platform.id]);
  });

  /**
   * **The one assertion in this file that guards somebody's money.**
   *
   * A search page is 1 credit and a comment page is 5, measured. US-028 found
   * the same shape on LinkedIn: where a request and a credit are different
   * numbers, a guard fed the search price for a comment page lets a monitor
   * spend five times its cap before anything refuses it.
   */
  it("prices a comment page at five times a search page, because it is", () => {
    expect(socialCrawlInstagram.billableUnit).toBe("credit");
    expect(socialCrawlInstagram.pricePerUnitMicros).toBe(8118);
    expect(socialCrawlInstagram.replyPricePerUnitMicros).toBe(5 * 8118);
  });

  it("declares that it reads replies, on the connector the registry builds", () => {
    const built = new SocialCrawlInstagramSource(runtimeWith(unreachableFetch));

    expect(socialCrawlInstagram.canFetchReplies).toBe(true);
    expect(built.canFetchReplies).toBe(true);
    expect(typeof built.fetchReplies).toBe("function");
  });
});

describe("one reel", () => {
  it("keeps the fields a post row has, from the real payload", () => {
    const post = toCandidatePost(itemsOf(search)[0]);

    expect(post?.externalId).toBe("3247568142291920450");
    expect(post?.url).toBe("https://www.instagram.com/reel/C0RrgThL2ZC/");
    expect(post?.text.length).toBeGreaterThan(0);
    expect(post?.postedAt).toEqual(new Date("2023-11-30T16:05:23.000Z"));
  });

  /**
   * A reel carries no title and no description — the caption is the only text
   * it has, which is why this platform's leads are in the comments. A reel
   * without one buys a classification to score silence.
   */
  it("drops a reel missing any field a row needs, rather than repairing it", () => {
    const real = (itemsOf(search)[0] as { post: Record<string, unknown> }).post;

    for (const missing of ["id", "url", "published_at", "content"]) {
      const { [missing]: _gone, ...rest } = real;
      expect(toCandidatePost({ post: rest })).toBeUndefined();
    }
  });

  /**
   * **Two upstream surfaces answer this one endpoint.**
   *
   * The catalogue says a date-filtered search is served by a different source,
   * and the capture confirmed it: the unfiltered page fills `engagement.views`
   * and leaves `likes` null, the filtered page does the opposite, their `ext`
   * bags carry different keys, and `author.display_name` is null on one and
   * filled on the other.
   *
   * One parser reads both only because every field it needs is filled on both.
   * That is checked here rather than assumed, because the day one surface stops
   * sending a caption is the day a poll silently stores nothing.
   */
  it("reads both surfaces the one endpoint answers with", () => {
    for (const page of [search, searchDated]) {
      const posts = itemsOf(page).map((item) => toCandidatePost(item));

      expect(posts.length).toBeGreaterThan(0);
      expect(posts.every((post) => post !== undefined)).toBe(true);
      expect(posts.every((post) => post?.author !== undefined)).toBe(true);
    }
  });

  /**
   * Instagram leaves `display_name` null on the unfiltered surface and fills
   * the handle instead. A reel shown with no author is a lead a person cannot
   * judge, so the handle is the fallback — and it is never used instead of a
   * name the platform did send.
   */
  it("names the author by handle where there is no display name", () => {
    expect(toCandidatePost(itemsOf(search)[0])?.author).toBe("instagram-user-64");
    expect(toCandidatePost(itemsOf(searchDated)[0])?.author).toBe("instagram-user-143");
  });

  it("carries the comment count, which is what decides whether a thread opens", () => {
    const counted = itemsOf(search)
      .map((item) => toCandidatePost(item))
      .filter((post) => post?.replyCount !== undefined);

    expect(counted.length).toBeGreaterThan(0);
  });
});

describe("the date window, which this endpoint cannot work without", () => {
  /**
   * **The measurement that shaped this connector.**
   *
   * With no window, thirty results for this query ran from December 2021 to
   * April 2026 in relevance order, and the newest was five months old. A
   * monitor asking what was said since it last looked would be billed a credit
   * a poll to be handed nothing that passed its `since`, forever.
   *
   * So the window is always sent. `linkedin.ts` sends none in this case and
   * takes what it is given; here that is the broken choice, not the neutral
   * one, and this case is what stops it being copied over.
   */
  it("always sends a window, even with no since at all", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([search]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    await source.search(request());

    expect(calls[0]?.url).toContain("/v1/instagram/search/reels");
    expect(calls[0]?.url).toContain("date_posted=last-year");
  });

  it("asks for the narrowest window that still covers the monitor's since", async () => {
    const cases = [
      { hoursBack: 0.5, window: "last-hour" },
      { hoursBack: 5, window: "last-day" },
      { hoursBack: 24 * 3, window: "last-week" },
      { hoursBack: 24 * 9, window: "last-month" },
      { hoursBack: 24 * 200, window: "last-year" },
      // Older than every window there is, so the widest one and cut here.
      { hoursBack: 24 * 900, window: "last-year" },
    ];

    for (const { hoursBack, window } of cases) {
      const { fetch: fetchStub, calls } = socialCrawl([search]);
      const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));
      const since = new Date(Date.parse("2026-09-06T13:00:00.000Z") - hoursBack * 3_600_000);

      await source.search(request({ query: { queries: ["a"], channels: [], since } }));

      expect(calls[0]?.url).toContain(`date_posted=${window}`);
    }
  });

  /**
   * The window narrows to a whole bucket and the narrowest is an hour, so posts
   * older than `since` arrive whether we asked for them or not. Every row is
   * tested, and the walk is never stopped at the first old one: the order here
   * is relevance, and the captured page ran 2023, 2026, 2024, 2025, 2023.
   */
  it("cuts every row on the monitor's window, and bills anyway", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const since = new Date("2026-01-01T00:00:00.000Z");
    const result = await source.search(request({ query: { queries: ["a"], channels: [], since } }));

    expect(result.posts.every((post) => post.postedAt > since)).toBe(true);
    // A fresh reel sitting behind an old one is kept, which is the whole point.
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThan(itemsOf(search).length);
    // The credit was spent on the request, not on what survived.
    expect(result.unitsConsumed).toBe(1);
  });
});

describe("paging a search", () => {
  it("follows the cursor to a second page", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([search, searchDated]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    expect(first.next.status).toBe("ready");
    if (first.next.status !== "ready") return;

    await source.search(request({ cursor: first.next.cursor }));

    expect(calls[1]?.url).toContain("cursor=");
  });

  /**
   * **`has_more` is wrong here, and this is the case that says so.**
   *
   * The captured second page came back with zero items, `page_size: 0`, zero
   * credits and `has_more: true` beside a fresh cursor. A connector that read
   * the flag would walk that cursor for as long as the provider kept handing
   * one over.
   *
   * Ending the walk on an empty page is not the same as reading an empty answer
   * as "this query is finished for good", which US-006 measured to be wrong on
   * X. Nothing is remembered — the next poll starts this query at page one.
   */
  it("stops on an empty page, whatever has_more says", async () => {
    const { fetch: fetchStub } = socialCrawl([search, searchPage2]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    if (first.next.status !== "ready") throw new Error("expected a cursor");

    const second = await source.search(request({ cursor: first.next.cursor }));

    // The provider still offered one, and it was still ignored.
    const pagination = (searchPage2.body as { pagination?: { has_more?: boolean } }).pagination;
    expect(pagination?.has_more).toBe(true);
    expect(second.posts).toEqual([]);
    expect(second.unitsConsumed).toBe(0);
    expect(second.next.status).toBe("done");
  });

  it("stops after the page limit, however much more is offered", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const first = await source.search(request());
    if (first.next.status !== "ready") throw new Error("expected a cursor");

    expect((await source.search(request({ cursor: first.next.cursor }))).next.status).toBe("done");
  });

  it("moves to the monitor's next query rather than finishing on the first", async () => {
    const { fetch: fetchStub } = socialCrawl([search]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

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
    const source = new SocialCrawlInstagramSource(runtimeWith(unreachableFetch));

    await expect(source.search(request({ cursor: "not-ours" }))).rejects.toThrow(
      "was not issued by this source",
    );
  });
});

describe("reading the comments under a reel", () => {
  const replyRequest = {
    postUrl: "https://www.instagram.com/reel/DPDwh4-CW8W/",
    postExternalId: "3730038351538515734",
    credentials,
  };

  /**
   * `sort=recent`, not the endpoint's default of `top`.
   *
   * The captured `recent` page arrived strictly newest-first where the `top`
   * page did not, the catalogue warns that a `top` walk repeats itself once it
   * pages past the ranked head, and a repeated page here costs five credits.
   * US-048 adds the product reason: leads sit deeper than engagement ranking
   * puts them, because a question collects no likes.
   */
  it("asks for the newest comments, on the thread it was given", async () => {
    const { fetch: fetchStub, calls } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    await source.fetchReplies(replyRequest);

    expect(calls[0]?.url).toContain("/v1/instagram/post/comments");
    expect(calls[0]?.url).toContain(encodeURIComponent(replyRequest.postUrl));
    expect(calls[0]?.url).toContain("sort=recent");
  });

  /**
   * The shared parser reads this without a line of Instagram's own — the fifth
   * platform for which that holds, and the first to leave three of the nine
   * fields null on every comment.
   */
  it("parses a page through the shared parser, linked to its reel", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.length).toBe(itemsOf(commentsRecent).length);
    expect(
      result.replies.every((reply) => reply.parentPostExternalId === replyRequest.postExternalId),
    ).toBe(true);
    expect(result.replies.every((reply) => reply.text.length > 0)).toBe(true);
    expect(result.unitsConsumed).toBe(5);
  });

  /**
   * **`post_id` is null on every Instagram comment**, where X, YouTube and
   * TikTok fill it on all 137 captured. BUG-007's check therefore decides
   * nothing here, and the comments are kept rather than dropped — absence is
   * not disagreement.
   *
   * This is asserted so that the day the provider starts sending the field, a
   * reader can see what changed and what stopped being inert.
   */
  it("keeps a comment that names no parent post, because none of them do", () => {
    const postIds = itemsOf(commentsRecent).map(
      (item) => (item as { comment: { post_id: unknown } }).comment.post_id,
    );

    expect(postIds.every((id) => id === null)).toBe(true);
  });

  /**
   * Instagram fills `author.display_name` on no comment and `username` on every
   * one. The shared parser falls back, and a reply with no author at all is a
   * lead a person cannot judge.
   */
  it("names every commenter, by handle", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.every((reply) => reply.author !== undefined)).toBe(true);
    expect(result.replies[0]?.author).toBe("instagram-user-169");
  });

  /**
   * The comment permalink, in the shape the provider documents and accepts:
   * `/p/{shortcode}/c/{commentId}/`. A search result is a `/reel/` URL, so the
   * shortcode is lifted out and the path rebuilt.
   *
   * **Nobody has opened one.** US-047 opened one link per platform and found
   * TikTok's broken — a format this repository invented, which survived a
   * capture, two live polls and a comment admitting it was a guess, because
   * nobody pressed it. This one is read off the provider rather than invented,
   * and that is a better source, not a proof.
   */
  it("builds the comment permalink the provider documents", () => {
    expect(commentLink("https://www.instagram.com/reel/DPDwh4-CW8W/", "18047529779658999")).toBe(
      "https://www.instagram.com/p/DPDwh4-CW8W/c/18047529779658999/",
    );
    expect(commentLink("https://www.instagram.com/p/CnpPou9hWqq/", "18007013966365752")).toBe(
      "https://www.instagram.com/p/CnpPou9hWqq/c/18007013966365752/",
    );
  });

  it("still returns a link for a post URL it cannot read a shortcode from", () => {
    expect(commentLink("https://www.instagram.com/something-else", "17962049546986019")).toBe(
      "https://www.instagram.com/something-else/c/17962049546986019/",
    );
  });

  it("links every comment to itself, not to the reel", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.replies.every((reply) => reply.url.includes("/c/"))).toBe(true);
    // The id is carried, so two comments under one reel do not share a link.
    expect(new Set(result.replies.map((reply) => reply.url)).size).toBe(result.replies.length);
  });

  it("drops what was said before the window, testing every row", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const all = await source.fetchReplies(replyRequest);
    const since = new Date("2025-09-29T00:00:00.000Z");
    const recent = await source.fetchReplies({ ...replyRequest, since });

    expect(recent.replies.length).toBeGreaterThan(0);
    expect(recent.replies.length).toBeLessThan(all.replies.length);
    expect(recent.replies.every((reply) => reply.postedAt > since)).toBe(true);
    // The page was bought whole, whatever survived the cut.
    expect(recent.itemsReturned).toBe(all.itemsReturned);
    expect(recent.unitsConsumed).toBe(5);
  });

  it("counts a thread position through the walk, not from each page", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies({ ...replyRequest, positionOffset: 40 });

    expect(result.replies[0]?.threadPosition).toBe(40);
  });

  it("reports partial while the provider offers another page", async () => {
    const { fetch: fetchStub } = socialCrawl([commentsRecent]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const result = await source.fetchReplies(replyRequest);

    expect(result.next.status).toBe("ready");
    expect(result.partial).toBe(true);
  });
});

describe("the key", () => {
  it("says the provider refused it, in the provider's own words", async () => {
    const { fetch: fetchStub } = socialCrawl([credentialsRejected]);
    const source = new SocialCrawlInstagramSource(runtimeWith(fetchStub));

    const check = await source.validateCredentials(credentials);

    expect(check).toEqual({
      valid: false,
      reason: expect.stringContaining("Keys start with 'sc_'") as unknown as string,
    });
    // The refusal was free, which is what makes testing a key before storing
    // it safe on the 5-credit half of this provider too.
    expect((credentialsRejected.body as { credits_used: number }).credits_used).toBe(0);
  });

  it("asks for a key before it asks the provider", async () => {
    const source = new SocialCrawlInstagramSource(runtimeWith(unreachableFetch));

    expect(await source.validateCredentials({})).toEqual({
      valid: false,
      reason: "Enter your SocialCrawl API key.",
    });
  });
});
