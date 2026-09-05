/**
 * The ScrapeCreators half of the Reddit connector.
 *
 * This file, its siblings and the fixtures beside them are the only places in
 * the repository that name ScrapeCreators. STACK.md, *A source is not a
 * provider*: a user connects Reddit, and replacing the provider must change no
 * monitor, no score and no match.
 *
 * Every shape below was captured from a live account by `fixtures/capture.mjs`
 * on 2026-09-05, not read from the documentation. Three of the facts it
 * settled are not in the documentation at all:
 *
 * 1. **The API is synchronous.** A search answered in 1.8 to 4.9 seconds with
 *    the posts in the body. There is no snapshot and nothing to poll, so this
 *    connector never returns `next: { status: "wait" }` on a healthy call.
 *    Bright Data's does, and that difference is the whole reason the interface
 *    carries the state rather than the caller assuming one shape.
 * 2. **The response says what it charged.** `credits_charged` is on every
 *    answer, including the ones that charge nothing. That is `unitsConsumed`
 *    measured rather than assumed, which is the only kind the budget guard is
 *    allowed to count.
 * 3. **A timeframe is refused beside `sort=new`.** The provider answers "You
 *    need to sort by 'top' to provide a timeframe". A monitor wants what was
 *    said since it last looked, so the sort is not negotiable and the
 *    timeframe is the thing we give up. `since` is applied here instead.
 */
import type { Logger } from "../../../logger.js";
import type { SourceRuntime } from "../../types.js";

const apiBase = "https://api.scrapecreators.com/v1/reddit";

/**
 * The two endpoints a monitor needs, and the two discovery modes the Bright
 * Data connector already has: a keyword search across Reddit, and the recent
 * posts of one subreddit.
 */
export const endpoints = {
  search: `${apiBase}/search`,
  subreddit: `${apiBase}/subreddit`,
} as const;

/**
 * Newest first, on both endpoints.
 *
 * A monitor wants what was said since it last looked, and a popular
 * six-month-old thread is not a lead. It also makes the `since` cut cheap: on
 * a newest-first list, the first post older than `since` means every post
 * after it is too, so the connector can stop paging instead of paying for
 * pages it will discard.
 */
export const sortNewest = "new";

/**
 * A refusal from ScrapeCreators, already turned into a sentence a user can act
 * on.
 *
 * `credentials` and `input` are separated because a user told to check their
 * key when the query was malformed will check their key, find it correct, and
 * have nowhere left to go. In a bring-your-own-keys product this sentence is
 * the whole support channel.
 */
export class ScrapeCreatorsError extends Error {
  constructor(
    readonly kind: "credentials" | "input" | "rateLimit" | "provider",
    message: string,
    readonly httpStatus: number,
    /** Set only on `rateLimit`, and only when the provider named a time. */
    readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "ScrapeCreatorsError";
  }
}

/** One page of posts, and what the provider says it charged for them. */
export interface Page {
  /** The records as they arrived. Parsing them is the connector's job. */
  readonly records: readonly unknown[];
  /** The provider's cursor. Absent means this input has no more pages. */
  readonly after?: string;
  /**
   * What the provider says this call cost, in credits.
   *
   * Read from the response rather than counted here. Never the post count: one
   * credit bought 7 posts on a keyword search and 23 on a subreddit in the
   * same capture run, and a unit derived from either number would be wrong
   * about the other.
   */
  readonly creditsCharged: number;
}

/** How long to wait when the provider rate-limits us and names no time. */
const defaultRetrySeconds = 60;

interface Answer {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly retryAfterHeader: string | null;
}

export interface ScrapeCreatorsClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiKey: string;
}

export class ScrapeCreatorsClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;

  constructor({ runtime, apiKey }: ScrapeCreatorsClientOptions) {
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
    // answers with a bare string, and there is no reason to assume this
    // provider is stricter, so parsing strictly would turn the one error a
    // user can fix into an unreadable parse failure.
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
   * Turn a failure into a `ScrapeCreatorsError` whose kind says who has to do
   * something about it.
   *
   * The provider's own `message` is repeated rather than replaced. Ours would
   * go stale the next time the provider changes what it accepts, and theirs
   * names the offending parameter.
   */
  private fail(answer: Answer): ScrapeCreatorsError {
    const { httpStatus, body } = answer;
    const record =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof record.message === "string" ? record.message : "";
    const text = typeof body === "string" ? body : message;

    if (httpStatus === 401 || httpStatus === 403) {
      return new ScrapeCreatorsError(
        "credentials",
        // "Invalid API key" is what the provider said on 2026-09-05. Repeating
        // it and then saying where to fix it is more use than either alone.
        `ScrapeCreators rejected the API key${text ? ` (${text})` : ""}. ` +
          "Check SCRAPECREATORS_API_KEY, or create a new key at scrapecreators.com.",
        httpStatus,
      );
    }

    // Never measured. The capture run never hit a limit, so this branch is our
    // half of a contract the provider has not yet shown us. Say so until one
    // has happened.
    if (httpStatus === 429) {
      return new ScrapeCreatorsError(
        "rateLimit",
        "ScrapeCreators is rate-limiting this key.",
        httpStatus,
        this.retryAt(answer.retryAfterHeader),
      );
    }

    if (httpStatus === 400) {
      return new ScrapeCreatorsError(
        "input",
        `ScrapeCreators refused the query${text ? ` (${text})` : ""}.`,
        httpStatus,
      );
    }

    return new ScrapeCreatorsError(
      "provider",
      `ScrapeCreators answered ${httpStatus}${text ? `: ${text.slice(0, 200)}` : ""}.`,
      httpStatus,
    );
  }

  /**
   * Fetch one page.
   *
   * There is no snapshot and no waiting: the posts are in this answer. That is
   * a measured fact and not a simplification — see the header.
   */
  async fetchPage(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Page> {
    const answer = await this.call(endpoint, params, signal);

    if (answer.httpStatus !== 200) throw this.fail(answer);

    const body =
      typeof answer.body === "object" && answer.body !== null
        ? (answer.body as Record<string, unknown>)
        : {};

    const records = Array.isArray(body.posts) ? body.posts : [];
    const after = typeof body.after === "string" && body.after !== "" ? body.after : undefined;

    return {
      records,
      ...(after ? { after } : {}),
      creditsCharged: this.chargeOf(body),
    };
  }

  /**
   * Check a key without spending anything.
   *
   * The probe is a search with no `query`. The provider checks the key first
   * and the parameters second, so a bad key is refused at 401 and a good one
   * gets as far as complaining that the query is missing. Both answers were
   * captured, and both charged nothing: `credits_charged` was 0 on the refusal
   * and absent on the 401, which never reached the account at all.
   *
   * Resolving means the key works. Throwing means it does not, or that the
   * provider could not be reached — and those are different answers, which is
   * why the caller reads the error's `kind` rather than a boolean.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const answer = await this.call(endpoints.search, {}, signal);

    // The key got past authentication and the provider complained about the
    // missing parameter instead. That is the success case for a probe.
    if (answer.httpStatus === 400) return;
    if (answer.httpStatus === 200) return;

    throw this.fail(answer);
  }

  /**
   * What the provider says the call cost.
   *
   * A missing `credits_charged` on a successful answer means the wire format
   * moved. One credit is the documented price of every endpoint this connector
   * uses, so that is the fallback — and it is logged, because a budget guard
   * counting a guess should not do it quietly. Guessing low would be the
   * dangerous direction: it spends past a cap and reports that it did not.
   */
  private chargeOf(body: Record<string, unknown>): number {
    const charged = body.credits_charged;
    if (typeof charged === "number" && Number.isFinite(charged) && charged >= 0) return charged;

    warnOnce(
      this.runtime.logger,
      "scrapecreators-credits-charged-missing",
      "ScrapeCreators did not report credits_charged; counting this call as one credit",
    );

    return 1;
  }

  private retryAt(header: string | null): Date {
    const seconds = header && /^\d+$/.test(header) ? Number(header) : defaultRetrySeconds;
    return new Date(this.runtime.now().getTime() + seconds * 1000);
  }
}

/**
 * Say a thing once per process.
 *
 * Once, because the caller is a poll that runs every hour for every monitor. A
 * line per poll is a line nobody reads, and a warning nobody reads is not a
 * warning.
 */
const warned = new Set<string>();

function warnOnce(logger: Logger, key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn({ provider: "scrapecreators" }, message);
}
