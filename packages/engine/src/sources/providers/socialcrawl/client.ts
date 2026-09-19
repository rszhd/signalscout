/**
 * The SocialCrawl transport, shared by every platform fetched through it.
 * This file, its siblings and their fixtures are the only places that name
 * the provider (STACK.md, *A source is not a provider*).
 *
 * One key, one authentication header and one error vocabulary live here.
 * Each platform supplies an `EndpointProfile` for what differs: the URL, where
 * the endpoint puts its cursor, and what a call costs when the answer does not
 * say. The API is synchronous, so a healthy call never returns
 * `next: { status: "wait" }`.
 *
 * Every shape below was captured, not read from the documentation, and the
 * endpoints disagree with each other on cursors, on whether an empty search
 * is free and on whether one exists at all. docs/history.md, *Sources: what
 * was measured*, lists what each capture settled.
 */
import type { SourceRuntime } from "../../types.js";

const apiBase = "https://www.socialcrawl.dev/v1";

/**
 * The endpoints this provider gives us, one per platform.
 *
 * The X one is the reason this provider exists here: it is the only keyword
 * search across X that any of our three providers offers. A monitor's channels
 * are handles, and they reach the same endpoint through X's own `from:`
 * operator rather than through a second call. One endpoint for both discovery
 * modes is the provider's shape, not a simplification of ours.
 *
 * The LinkedIn one has no such operator, and no `sort` either. What it has
 * instead is a `date_posted` window, which is why the LinkedIn connector is
 * not the X connector with a different URL.
 */
export const endpoints = {
  search: `${apiBase}/twitter/search/tweets`,
  /** The replies under one post, by URL. One credit and a cursor. US-020. */
  xReplies: `${apiBase}/twitter/tweet/replies`,
  /** TikTok, US-044. Search and comments, one credit each. */
  tikTokSearch: `${apiBase}/tiktok/search`,
  tikTokComments: `${apiBase}/tiktok/post/comments`,
  /** Reddit, US-031. Three discovery modes, one credit each. */
  redditSearch: `${apiBase}/reddit/search`,
  redditSubreddit: `${apiBase}/reddit/subreddit`,
  /** The one no other provider has: a keyword inside one subreddit. */
  redditSubredditSearch: `${apiBase}/reddit/subreddit/search`,
  /**
   * The comments under one Reddit post, by URL. Five credits, US-159.
   *
   * It is the one comment endpoint here that answers with a tree rather than a
   * page: 34 of 34 claimed comments arrived in one call, nested five levels
   * deep in `replies` arrays, with no cursor at all. That is what the five
   * credits buy, against ScrapeCreators' one credit for a flat page of 25 that
   * cannot finish a busy thread.
   */
  redditComments: `${apiBase}/reddit/post/comments`,
  linkedInPosts: `${apiBase}/linkedin/search/posts`,
  /**
   * YouTube. US-034.
   *
   * `/v1/youtube/search/advanced` is the endpoint the provider's own catalogue
   * says to prefer for date filtering, and it answers 400 INVALID_REQUEST to
   * the `published_after` parameter that catalogue lists. The refusal is
   * refunded, so learning it was free — but it is why the plain search is here
   * and the advanced one is not.
   */
  youTubeSearch: `${apiBase}/youtube/search`,
  youTubeComments: `${apiBase}/youtube/video/comments`,
  /**
   * Instagram. US-049, and the first endpoint pair here whose two halves are
   * priced differently: a reel search is 1 credit and a comment page is 5.
   *
   * `/search/reels` rather than `/search/hashtag` because the second is five
   * times the price for a mode a monitor did not ask for — a hashtag is a
   * publisher's label, and the product looks for a stranger describing a
   * problem. `/search/profiles` is 1 credit and is not a discovery mode at all:
   * it is a Google-backed lookup returning accounts.
   */
  instagramSearch: `${apiBase}/instagram/search/reels`,
  instagramComments: `${apiBase}/instagram/post/comments`,
} as const;

/**
 * The three things one endpoint does differently from the next, at the same
 * provider, behind the same key.
 *
 * They are named here rather than sensed from the answer because each one is a
 * measurement. Reading a cursor "wherever it happens to be" would have picked
 * the wrong one of the two X carries, and falling back to a credit count the
 * answer did not give would misprice a whole poll.
 */
export interface EndpointProfile {
  readonly endpoint: string;
  /**
   * What one standard call costs when the provider does not say.
   *
   * Every captured answer reported `credits_used`, so this is a fallback that
   * has never been used. It is never 0: the guard's job is to refuse, and a
   * call recorded as free that was not is how a cap is passed silently.
   * Over-reporting stops a monitor early, which a person can see and undo.
   */
  readonly standardCallCredits: number;
  /** Where this endpoint puts its cursor, and whether it has one at all. */
  readonly cursorOf: (body: Record<string, unknown>) => string | undefined;
}

/**
 * X: `data.next_cursor`, and one credit a call.
 *
 * The answer also carries `pagination.next_cursor`, a different string wrapping
 * the same place. This is the one a live run followed to a second page.
 */
export const xSearchProfile: EndpointProfile = {
  endpoint: endpoints.search,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const data = objectAt(body, "data");
    return text(data?.next_cursor);
  },
};

/**
 * LinkedIn: `pagination.next_cursor`, and five credits a call.
 *
 * The documentation describes no pagination for this endpoint at all. The
 * capture run found a cursor anyway, followed it, and got ten more posts with
 * no overlap against page one — so the documentation is wrong rather than
 * merely quiet, and a connector written from it would have paid for one page
 * and called the query finished.
 *
 * `has_more` is read as well as the cursor. The two agreed on every captured
 * answer, and believing the flag when they disagree is the safe direction:
 * the cost of stopping early is a post found on the next poll, and the cost of
 * paging on is five credits for nothing.
 */
/**
 * X replies: the same cursor and the same price as an X search.
 *
 * **Its `has_more` cannot be trusted, and that is measured.** A captured page
 * of 28 replies reported `has_more: true` with a cursor; following that cursor
 * returned zero items. This is the third ordering-or-completeness claim in this
 * repository to be wrong, after ScrapeCreators' Reddit `has_more: false` with
 * 33 comments missing.
 *
 * It is the cheap kind of wrong, though: the empty page cost nothing, because
 * the provider refunds a call that matches nothing. So a connector that follows
 * the cursor one page too far pays for its trust in nothing but time.
 */
export const xRepliesProfile: EndpointProfile = {
  endpoint: endpoints.xReplies,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

/**
 * Reddit, all three modes: `pagination.next_cursor`, one credit a call.
 *
 * They share a profile shape because they share an envelope — the difference
 * between them is which parameters go in, which is the connector's business.
 */
const redditProfile = (endpoint: string): EndpointProfile => ({
  endpoint,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
});

/**
 * TikTok, both endpoints: `pagination.next_cursor`, one credit a call.
 *
 * The same shape as every other SocialCrawl endpoint, which is what makes the
 * shared reply parser work here without a line of its own. US-044 measured a
 * search page at 30 videos and a comment page at up to 50.
 */
export const tikTokSearchProfile = redditProfile(endpoints.tikTokSearch);
export const tikTokCommentsProfile = redditProfile(endpoints.tikTokComments);

export const redditSearchProfile = redditProfile(endpoints.redditSearch);
/**
 * Reddit comments: the same envelope, and **five times the price**.
 *
 * The only endpoint in this product that returns a whole thread for one call.
 * Measured on 2026-09-17: no cursor, `has_more: false`, and every one of the
 * 34 comments the post claimed, five levels deep. So `standardCallCredits` is
 * 5 and the walk it feeds ends after one call.
 */
export const redditCommentsProfile: EndpointProfile = {
  endpoint: endpoints.redditComments,
  standardCallCredits: 5,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};
export const redditSubredditProfile = redditProfile(endpoints.redditSubreddit);
export const redditSubredditSearchProfile = redditProfile(endpoints.redditSubredditSearch);

/**
 * YouTube search: `pagination.next_cursor`, and one credit a call.
 *
 * A page carried 45 results for one credit, which is the most items per credit
 * of any search this product makes. The cursor is a long base64 blob and page
 * two returned 25 more with none of page one's among them.
 *
 * A search that matches nothing is billed in full and does not come back
 * empty: a phrase that cannot occur returned twelve unrelated videos. Same as
 * LinkedIn, opposite of X, and it is why nothing here treats an empty answer
 * as a finished query.
 */
export const youTubeSearchProfile: EndpointProfile = {
  endpoint: endpoints.youTubeSearch,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

/**
 * YouTube comments: the same cursor and the same price as the search.
 *
 * One page returned 51 comments for one credit — twice ScrapeCreators' Reddit
 * page for the same money — and every row carried an exact per-second
 * timestamp. With `order=newest` they arrived strictly newest-first with no
 * exception, which is the guarantee ScrapeCreators claimed for Reddit and
 * broke by 33 comments. Measured on 2026-09-06; `youtube-fixtures/` holds it.
 */
export const youTubeCommentsProfile: EndpointProfile = {
  endpoint: endpoints.youTubeComments,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

/**
 * Instagram search: `pagination.next_cursor`, one credit a call.
 *
 * **`has_more` is wrong here, and it was measured wrong on the first run.**
 * Page one of `skincare for acne scars` returned 30 reels with
 * `has_more: true` and a cursor. Following that cursor returned **zero items,
 * `page_size: 0`, and another `has_more: true` with another cursor**. So the
 * flag does not mean there is more, and the cursor it comes with can lead
 * nowhere. That is the fourth completeness claim from a provider to be measured
 * wrong in this repository, after ScrapeCreators' Reddit `has_more: false` with
 * 33 comments missing and X's replies cursor to an empty page.
 *
 * It is the cheap kind of wrong: the empty page reported `credits_used: 0`. So
 * the connector stops on an empty page rather than on the flag, and pays
 * nothing to learn it.
 *
 * The flag is still read where it says `false`, on the same reasoning the other
 * profiles use — a stop it reports is a stop we can take for free.
 */
export const instagramSearchProfile: EndpointProfile = {
  endpoint: endpoints.instagramSearch,
  standardCallCredits: 1,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

/**
 * Instagram comments: the same cursor, and **five times the price**.
 *
 * 5 credits a page against 1 for the search beside it, 1 for a TikTok comment
 * page and 1 for a YouTube one. That is the same trap US-028 found on LinkedIn:
 * where a request and a credit are different numbers, a guard fed the wrong one
 * lets a monitor spend five times its cap. The connector declares this price
 * separately from its search price for exactly that reason.
 *
 * A page held 15 comments on a thread the provider said had 71, so a whole
 * thread here is several pages at 5 credits each.
 */
export const instagramCommentsProfile: EndpointProfile = {
  endpoint: endpoints.instagramComments,
  standardCallCredits: 5,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

export const linkedInPostSearchProfile: EndpointProfile = {
  endpoint: endpoints.linkedInPosts,
  standardCallCredits: 5,
  cursorOf: (body) => {
    const pagination = objectAt(body, "pagination");
    if (pagination?.has_more === false) return undefined;
    return text(pagination?.next_cursor);
  },
};

function objectAt(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Newest first.
 *
 * A monitor wants what was said since it last looked, and the alternative
 * value ranks by engagement: asked for broken end-to-end tests under that
 * sort, the provider returned anime, Bitcoin and a CIA story across three
 * weeks. It also makes the `since` cut cheap — on a newest-first list, the
 * first post older than `since` means every post after it is older too.
 */
export const sortNewest = "latest";

/**
 * A refusal from SocialCrawl, already turned into a sentence a user can act
 * on.
 *
 * `credentials` and `input` are separated because a user told to check their
 * key when the query was malformed will check their key, find it correct, and
 * have nowhere left to go. In a bring-your-own-keys product this sentence is
 * the whole support channel.
 */
export class SocialCrawlError extends Error {
  constructor(
    readonly kind: "credentials" | "input" | "rateLimit" | "provider",
    message: string,
    readonly httpStatus: number,
    /** Set only on `rateLimit`, and only when the provider named a time. */
    readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "SocialCrawlError";
  }
}

/** One page of posts, and what the provider says it charged for them. */
export interface Page {
  /** The records as they arrived. Parsing them is the connector's job. */
  readonly records: readonly unknown[];
  /** The provider's cursor. Absent means this input has no more pages. */
  readonly cursor?: string;
  /**
   * What the provider says this call cost, in credits.
   *
   * Read from the response, never counted here. One credit bought twenty posts
   * on a full page and zero on an empty one in the same capture run, so a unit
   * derived from either number would be wrong about the other.
   */
  readonly creditsUsed: number;
  /**
   * The provider's own completeness claim, where it makes one.
   *
   * `data.truncated` arrives on the Reddit comment answer and on nothing else
   * this product calls — US-020 recorded that Reddit's envelope carries it
   * where X's carries a cursor instead. It is surfaced here rather than parsed
   * in the connector because it sits in the envelope, which is the client's
   * half of the split.
   *
   * Absent means the endpoint made no claim, which is not the same as claiming
   * completeness. A connector reads it that way or not at all.
   */
  readonly truncated?: boolean;
}

/** How long to wait when the provider rate-limits us and names no time. */
const defaultRetrySeconds = 60;

interface Answer {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly retryAfterHeader: string | null;
}

export interface SocialCrawlClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiKey: string;
  /**
   * Which endpoint this client speaks to. It defaults to X's, so the connector
   * US-006 shipped constructs a client the way it always did.
   */
  readonly profile?: EndpointProfile;
}

export class SocialCrawlClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;
  private readonly profile: EndpointProfile;

  constructor({ runtime, apiKey, profile }: SocialCrawlClientOptions) {
    this.runtime = runtime;
    this.apiKey = apiKey;
    this.profile = profile ?? xSearchProfile;
  }

  private async call(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Answer> {
    const response = await this.runtime.fetch(`${endpoint}?${new URLSearchParams(params)}`, {
      headers: { "x-api-key": this.apiKey },
      ...(signal ? { signal } : {}),
    });

    const text = await response.text();

    // A refusal is not guaranteed to be JSON. Bright Data's invalid key
    // answers with a bare string, and parsing strictly would turn the one
    // error a user can fix into an unreadable parse failure.
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      httpStatus: response.status,
      body,
      retryAfterHeader: response.headers.get("retry-after"),
    };
  }

  /**
   * Turn a failure into a `SocialCrawlError` whose kind says who has to do
   * something about it.
   *
   * The provider's own sentence is repeated rather than replaced. Ours would
   * go stale the next time the provider changes what it accepts, and theirs
   * names the offending parameter: "Invalid value for 'sort': 'x'. Allowed
   * values: latest, top."
   */
  private fail(answer: Answer): SocialCrawlError {
    const { httpStatus, body } = answer;
    const message = errorMessage(body);
    const text = typeof body === "string" ? body : message;

    if (httpStatus === 401 || httpStatus === 403) {
      return new SocialCrawlError(
        "credentials",
        // "Invalid API key format. Keys start with 'sc_'." is what the
        // provider said on 2026-09-05. Repeating it and then saying where to
        // fix it is more use than either alone.
        `SocialCrawl rejected the API key${text ? ` (${text})` : ""}. ` +
          "Check SOCIALCRAWL_API_KEY, or create a new key at socialcrawl.dev.",
        httpStatus,
      );
    }

    // Never measured. The capture run never hit a limit, so this branch is our
    // half of a contract the provider has not yet shown us. Say so until one
    // has happened.
    if (httpStatus === 429) {
      return new SocialCrawlError(
        "rateLimit",
        "SocialCrawl is rate-limiting this key.",
        httpStatus,
        this.retryAt(answer.retryAfterHeader),
      );
    }

    if (httpStatus === 400) {
      return new SocialCrawlError(
        "input",
        `SocialCrawl refused the query${text ? ` (${text})` : ""}.`,
        httpStatus,
      );
    }

    return new SocialCrawlError(
      "provider",
      `SocialCrawl answered ${httpStatus}${text ? `: ${text.slice(0, 200)}` : ""}.`,
      httpStatus,
    );
  }

  private retryAt(header: string | null): Date {
    const seconds = Number(header);
    const wait = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : defaultRetrySeconds;
    return new Date(this.runtime.now().getTime() + wait * 1000);
  }

  /**
   * Ask whether the key works, without buying anything.
   *
   * A search with no `query` is refused on the parameter — 400, "Missing
   * required parameter(s): query" — and the refusal arrives only after the key
   * has been accepted, so a 401 and a 400 separate a bad key from a good one.
   * Both answers reported `credits_used: 0` and left the account's balance at
   * 100, which is the free-probe claim measured rather than argued.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const answer = await this.call(this.profile.endpoint, {}, signal);

    if (answer.httpStatus === 400) return;
    if (answer.httpStatus === 200) return;

    throw this.fail(answer);
  }

  /**
   * Fetch one page.
   *
   * There is no snapshot and no waiting: the posts are in this answer. That is
   * a measured fact and not a simplification — see the header.
   */
  async fetchPage(params: Record<string, string>, signal?: AbortSignal): Promise<Page> {
    const answer = await this.call(this.profile.endpoint, params, signal);

    if (answer.httpStatus !== 200) throw this.fail(answer);

    const body =
      typeof answer.body === "object" && answer.body !== null
        ? (answer.body as Record<string, unknown>)
        : {};

    // `success: false` with a 200 is not a shape the capture run produced, but
    // the envelope carries the flag on every answer, so trusting the status
    // alone would be trusting a field we can read instead.
    if (body.success === false) throw this.fail({ ...answer, httpStatus: 400 });

    const data =
      typeof body.data === "object" && body.data !== null
        ? (body.data as Record<string, unknown>)
        : {};

    const records = Array.isArray(data.items) ? data.items : [];
    const cursor = this.profile.cursorOf(body);

    return {
      records,
      creditsUsed: creditsOf(body, this.profile.standardCallCredits),
      ...(cursor ? { cursor } : {}),
      ...(typeof data.truncated === "boolean" ? { truncated: data.truncated } : {}),
    };
  }
}

/**
 * What the answer says it cost.
 *
 * A missing or unreadable value falls back to the price of a standard call
 * rather than to nothing, for the reason `EndpointProfile.standardCallCredits`
 * gives.
 *
 * A zero the provider *did* report is kept, and that is not the same thing. It
 * refunds a search that matched nothing on X, and it charges nothing for an
 * answer it served from its own cache — `cached: true`, measured on the
 * LinkedIn endpoint. Both are real zeroes and recording them as anything else
 * would overstate a monitor's spend.
 */
function creditsOf(body: Record<string, unknown>, standardCallCredits: number): number {
  const reported = body.credits_used;

  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }

  return standardCallCredits;
}

/** The provider's own sentence, which lives under `error.message`. */
function errorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";

  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return "";

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}
