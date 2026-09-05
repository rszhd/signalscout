/**
 * The SocialCrawl half of the X connector.
 *
 * This file, its siblings and the fixtures beside them are the only places in
 * the repository that name SocialCrawl. STACK.md, *A source is not a
 * provider*: a user connects X, and replacing the provider must change no
 * monitor, no score and no match.
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
 * The API is synchronous: a search answered in 1.5 to 5.3 seconds with the
 * posts in the body. There is no snapshot and nothing to poll, so this
 * connector never returns `next: { status: "wait" }` on a healthy call.
 */
import type { SourceRuntime } from "../../types.js";

const apiBase = "https://www.socialcrawl.dev/v1/twitter";

/**
 * One endpoint, and it is the reason this provider exists here. It is the only
 * keyword search across X that any of our three providers offers.
 *
 * A monitor's channels are handles, and they reach the same endpoint through
 * X's own `from:` operator rather than through a second call. One endpoint for
 * both discovery modes is the provider's shape, not a simplification of ours.
 */
export const endpoints = {
  search: `${apiBase}/search/tweets`,
} as const;

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
 * What one standard call costs when the provider does not say.
 *
 * Every captured answer reported `credits_used`, so this is a fallback that
 * has never been used. It is 1 rather than 0 on purpose: the guard's job is to
 * refuse, and a call recorded as free that was not is how a cap is passed
 * silently. Over-reporting stops a monitor early, which a person can see and
 * undo.
 */
const standardCallCredits = 1;

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
}

export class SocialCrawlClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;

  constructor({ runtime, apiKey }: SocialCrawlClientOptions) {
    this.runtime = runtime;
    this.apiKey = apiKey;
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
    const answer = await this.call(endpoints.search, {}, signal);

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
    const answer = await this.call(endpoints.search, params, signal);

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
    const cursor =
      typeof data.next_cursor === "string" && data.next_cursor !== ""
        ? data.next_cursor
        : undefined;

    return {
      records,
      creditsUsed: creditsOf(body),
      ...(cursor ? { cursor } : {}),
    };
  }
}

/**
 * What the answer says it cost.
 *
 * A missing or unreadable value falls back to the price of a standard call
 * rather than to nothing, for the reason `standardCallCredits` gives.
 */
function creditsOf(body: Record<string, unknown>): number {
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
