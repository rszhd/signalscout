/**
 * The SocialData client, shared by every platform this provider fetches.
 *
 * Every shape below was captured from a live account by
 * `x-fixtures/capture.mjs` on 2026-09-07, not read from the documentation.
 *
 * **This provider is prepaid, and that is the difference from every other one
 * here.** A balance that runs out answers 402, which is neither a wrong key
 * nor a rate limit: retrying will not help, waiting will not help, and telling
 * the person to check their key sends them to look at the one thing that is
 * fine. So `balance` is its own error kind, and it is the only kind whose
 * repair is outside this product entirely.
 */
import type { Logger } from "../../../logger.js";
import type { SourceRuntime } from "../../types.js";

const apiBase = "https://api.socialdata.tools";

/**
 * The endpoints this provider gives us.
 *
 * `search` takes Twitter's own advanced operators inside `query`, which is
 * what lets a window be pushed to the provider — the one thing
 * `socialcrawl/x.ts` cannot do. `balance` is free and is how the capture
 * measured every price here, because no answer reports its own charge.
 */
export const endpoints = {
  search: `${apiBase}/twitter/search`,
  balance: `${apiBase}/user/balance`,
} as const;

/**
 * A refusal from SocialData, already turned into a sentence a user can act on.
 *
 * Four kinds rather than three. `credentials` and `input` are separated for
 * the reason every client here separates them: a user told to check their key
 * when the query was malformed will check their key, find it correct, and have
 * nowhere left to go. `balance` is the new one, and it is separate because its
 * repair is on the provider's website rather than in this product.
 */
export class SocialDataError extends Error {
  constructor(
    readonly kind: "credentials" | "balance" | "input" | "rateLimit" | "provider",
    message: string,
    readonly httpStatus: number,
    /** Set only on `rateLimit`, and only when the provider named a time. */
    readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "SocialDataError";
  }
}

/** One page of tweets, and how many of them the account was billed for. */
export interface Page {
  /** The records as they arrived. Parsing them is the connector's job. */
  readonly records: readonly unknown[];
  /** The provider's cursor. Absent means this query has no more pages. */
  readonly after?: string;
  /**
   * What this call cost, in tweets.
   *
   * The tweet *is* the billable unit — $0.0002 each, measured: twenty tweets
   * moved the balance by $0.0040 and seven moved it by $0.0014. So the count
   * is the charge, and unusually for this repository it is safe to read it
   * from the page length. No answer reports its own cost, and reading the
   * balance either side of every call would double the requests.
   */
  readonly tweetsReturned: number;
}

/** How long to wait when the provider rate-limits us and names no time. */
const defaultRetrySeconds = 60;

interface Answer {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly retryAfterHeader: string | null;
}

export interface SocialDataClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiKey: string;
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export class SocialDataClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;

  constructor({ runtime, apiKey }: SocialDataClientOptions) {
    this.runtime = runtime;
    this.apiKey = apiKey;
  }

  private async call(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Answer> {
    const query = new URLSearchParams(params).toString();

    const response = await this.runtime.fetch(query ? `${endpoint}?${query}` : endpoint, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });

    const body = await response.text();

    // A refusal is not guaranteed to be JSON. Parsing strictly would turn the
    // one error a user can fix into an unreadable parse failure.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    return {
      httpStatus: response.status,
      body: parsed,
      retryAfterHeader: response.headers.get("retry-after"),
    };
  }

  /**
   * Turn a failure into a `SocialDataError` whose kind says who has to do
   * something about it.
   *
   * The provider's own message is repeated rather than replaced. Ours would go
   * stale the next time the provider changes what it accepts.
   */
  private fail(answer: Answer): SocialDataError {
    const { httpStatus, body } = answer;
    const record = objectOf(body) ?? {};
    const message = text(record.message) ?? text(record.status) ?? "";
    const said = typeof body === "string" ? body : message;

    if (httpStatus === 401 || httpStatus === 403) {
      return new SocialDataError(
        "credentials",
        `SocialData rejected the API key${said ? ` (${said})` : ""}. ` +
          "Check SOCIALDATA_API_KEY — and quote it in .env, because a key " +
          "containing a pipe makes a shell load an empty value.",
        httpStatus,
      );
    }

    /**
     * The balance, and the reason this kind exists.
     *
     * Documented, and deliberately not reproduced: forcing a 402 means
     * draining the account. So this branch is our half of a contract the
     * provider has described and not yet shown us, and it says so.
     */
    if (httpStatus === 402) {
      return new SocialDataError(
        "balance",
        `SocialData has no balance left${said ? ` (${said})` : ""}. ` +
          "Top up the account at socialdata.tools — the key is fine and " +
          "retrying will not help.",
        httpStatus,
      );
    }

    // Never measured. No capture run has been rate-limited, so this branch is
    // our half of a contract the provider has not yet shown us.
    if (httpStatus === 429) {
      return new SocialDataError(
        "rateLimit",
        "SocialData is rate-limiting this key.",
        httpStatus,
        this.retryAt(answer.retryAfterHeader),
      );
    }

    if (httpStatus === 400 || httpStatus === 422) {
      return new SocialDataError(
        "input",
        `SocialData refused the query${said ? ` (${said})` : ""}.`,
        httpStatus,
      );
    }

    return new SocialDataError(
      "provider",
      `SocialData answered ${httpStatus}${said ? `: ${said.slice(0, 200)}` : ""}.`,
      httpStatus,
    );
  }

  /**
   * Fetch one page of search results.
   *
   * There is no snapshot and no waiting: the tweets are in this answer, so
   * this connector never returns a `wait` on a healthy call.
   */
  async fetchPage(params: Record<string, string>, signal?: AbortSignal): Promise<Page> {
    const answer = await this.call(endpoints.search, params, signal);

    if (answer.httpStatus !== 200) throw this.fail(answer);

    const body = objectOf(answer.body) ?? {};
    const records = Array.isArray(body.tweets) ? body.tweets : [];
    const after = text(body.next_cursor);

    return {
      records,
      ...(after ? { after } : {}),
      tweetsReturned: records.length,
    };
  }

  /**
   * Check a key without spending anything.
   *
   * The probe reads the balance, which costs nothing and needs no search — so
   * a person can check their key without being billed for finding out they
   * typed it correctly. It also answers the question a search cannot: an empty
   * account has a perfectly good key.
   *
   * Resolving means the key works. Throwing means it does not, or that the
   * provider could not be reached — and those are different answers, which is
   * why the caller reads the error's `kind` rather than a boolean.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const answer = await this.call(endpoints.balance, {}, signal);

    if (answer.httpStatus === 200) return;

    throw this.fail(answer);
  }

  /**
   * What the account has left, in micro-dollars, or undefined when unreadable.
   *
   * Nothing in the poll path uses this: the budget guard counts what a monitor
   * spends, and a prepaid balance is shared by every monitor and by whatever
   * else the person uses the key for. It is here because a screen that says
   * "no balance" before a poll fails is worth more than one that explains
   * afterwards, and because the capture needs it.
   */
  async balanceMicros(signal?: AbortSignal): Promise<number | undefined> {
    const answer = await this.call(endpoints.balance, {}, signal);

    if (answer.httpStatus !== 200) return undefined;

    const value = objectOf(answer.body)?.balance_usd;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      warnOnce(
        this.runtime.logger,
        "socialdata-balance-shape",
        "SocialData did not report balance_usd as a number; the balance is unknown",
      );
      return undefined;
    }

    return Math.round(value * 1_000_000);
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
  logger.warn({ provider: "socialdata" }, message);
}
