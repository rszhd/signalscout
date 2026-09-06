/**
 * The SocialCrawl transport, shared by every platform we fetch through it.
 *
 * This file, its siblings and the fixtures beside them are the only places in
 * the repository that name SocialCrawl. STACK.md, *A source is not a
 * provider*: a user connects X or LinkedIn, and replacing the provider must
 * change no monitor, no score and no match.
 *
 * One provider means one key, one authentication header and one error
 * vocabulary, so those live here and each platform supplies an
 * `EndpointProfile` for the three things that differ: which URL to call, where
 * that endpoint puts its cursor, and what one call costs when the answer does
 * not say. US-028 added the second profile and changed nothing about the
 * first.
 *
 * Every shape below was captured from a live account by `fixtures/capture.mjs`
 * on 2026-09-05, not read from the documentation. Four of the facts it settled
 * are wrong or absent in the documentation:
 *
 * 1. **The cursor is in two places and the documented one is not the only
 *    one.** The documentation names `data.next_cursor`. The answer also
 *    carries `pagination.next_cursor`, a different string with an `sc.` prefix
 *    wrapping the same place. `data.next_cursor` is the one this client sends
 *    back, because it is the one a live run followed to a second page.
 * 2. **`sort` accepts `latest` or `top`, and nothing else.** The documentation
 *    names only `top`. The provider listed both when it refused an invalid
 *    value, which cost nothing to ask.
 * 3. **An empty answer is free.** A search that matches nothing answers 200
 *    with `credits_used: 0`. ScrapeCreators bills for the same thing, so this
 *    is a fact about this provider and not a rule.
 * 4. **An empty answer is not always the truth.** The same query returned
 *    nothing at 20:12 and twenty posts at 20:31, both free. So no page of zero
 *    posts may be read as "this query is finished for good" — only as "there
 *    was nothing this time".
 *
 * The LinkedIn capture on the same day settled three more, and none of them
 * generalises from the X ones — which is the argument for a profile per
 * endpoint rather than one client that assumes:
 *
 * 5. **This endpoint pages, and the documentation says it does not.** The
 *    cursor is at `pagination.next_cursor`, `has_more` sits beside it, and
 *    page two returned ten posts with none of page one's among them.
 * 6. **A search that matches nothing is billed here, and is not empty.** A
 *    phrase that cannot occur returned ten unrelated posts, `total: 98`, and
 *    cost the full five credits. So an empty answer is not the signal on this
 *    endpoint that it is on X's — there is no empty answer to read.
 * 7. **The provider caches, and a cached answer is free.** The same query sent
 *    twice came back flagged `cached: true`, in a third of the time, for zero
 *    credits. No connector may count on it: the window is undocumented, and a
 *    cap sized on cached prices is a cap sized on somebody else's luck.
 *
 * The API is synchronous: a search answered in 1.4 to 5.3 seconds with the
 * posts in the body. There is no snapshot and nothing to poll, so these
 * connectors never return `next: { status: "wait" }` on a healthy call.
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
