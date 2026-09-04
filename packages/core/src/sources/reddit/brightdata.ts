/**
 * The Bright Data half of the Reddit connector.
 *
 * This file, its sibling and the fixtures beside them are the only places in
 * the repository that name Bright Data. STACK.md, *A source is not a
 * provider*: a user connects Reddit, and replacing the provider must change no
 * monitor, no score and no match.
 *
 * Every shape below was captured from a live account by `fixtures/capture.mjs`,
 * not read from the documentation. That distinction earned its keep on the
 * first run: the documented `date` value, the documented progress statuses and
 * the documented snapshot id prefix were all wrong.
 */
import type { SourceRuntime } from "../types.js";

const apiBase = "https://api.brightdata.com/datasets/v3";

/**
 * Bright Data addresses a scraper by dataset id, and posts and comments are two
 * different datasets. That is the provider's reason for charging twice when a
 * monitor wants comments, and it is not a fact the caller ever sees.
 */
export const datasets = {
  posts: "gd_lvz8ah06191smkebj4",
  comments: "gd_lvzdpsdlw09j6t702",
} as const;

/**
 * Keyword discovery requires a `date`, and it is a named range rather than a
 * date. Bright Data's documentation shows a calendar date; the API answers
 * `["date", "This value is not allowed"]` to one.
 *
 * Ordered narrowest first, so `dateRangeFor` can pick the smallest window that
 * still covers the caller's `since`. Asking for a wider window than needed is
 * not free: every record inside it is billed.
 */
export const dateRanges = ["Today", "Past week", "Past month", "All time"] as const;
export type DateRange = (typeof dateRanges)[number];

const rangeCoversMs: Record<DateRange, number> = {
  Today: 24 * 60 * 60 * 1000,
  "Past week": 7 * 24 * 60 * 60 * 1000,
  "Past month": 31 * 24 * 60 * 60 * 1000,
  "All time": Number.POSITIVE_INFINITY,
};

/**
 * The narrowest range that still reaches back to `since`.
 *
 * A range too narrow silently drops posts the caller asked for, and a silent
 * false negative is the failure nobody can see. So the comparison rounds
 * outwards: a `since` exactly one week old picks "Past week", and anything
 * older picks the next range up.
 */
export function dateRangeFor(since: Date | undefined, now: Date): DateRange {
  if (!since) return "All time";

  const age = now.getTime() - since.getTime();
  return dateRanges.find((range) => age <= rangeCoversMs[range]) ?? "All time";
}

/** A snapshot that is still collecting, and when the provider says to return. */
export interface SnapshotPending {
  readonly status: "pending";
  readonly retryAfter: Date;
}

/** A finished snapshot: the records, and the count the provider billed. */
export interface SnapshotReady {
  readonly status: "ready";
  readonly records: readonly unknown[];
  /**
   * What Bright Data says it collected. Taken from the provider's own progress
   * answer rather than from `records.length`, because those two numbers are
   * allowed to differ — a record that errored is still a record — and the one
   * that reaches the budget guard has to be the one that reaches the invoice.
   */
  readonly billedRecords: number;
}

export type SnapshotState = SnapshotPending | SnapshotReady;

/**
 * A refusal from Bright Data, already turned into a sentence a user can act
 * on.
 *
 * `credentials` and `input` are separated because a user told to check their
 * key when the query was malformed will check their key, find it correct, and
 * have nowhere left to go. In a bring-your-own-keys product this sentence is
 * the whole support channel.
 */
export class BrightDataError extends Error {
  constructor(
    readonly kind: "credentials" | "account" | "input" | "provider",
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "BrightDataError";
  }
}

/** How long to wait before the first poll, when the provider gives no hint. */
const defaultRetrySeconds = 30;

/** Pull "try again in 30s" out of the provider's own message, if it is there. */
function retrySecondsFrom(message: unknown): number {
  if (typeof message !== "string") return defaultRetrySeconds;
  const match = message.match(/(\d+)\s*s\b/);
  return match ? Number(match[1]) : defaultRetrySeconds;
}

interface Answer {
  readonly httpStatus: number;
  readonly body: unknown;
}

export interface BrightDataClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiKey: string;
}

export class BrightDataClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;

  constructor({ runtime, apiKey }: BrightDataClientOptions) {
    this.runtime = runtime;
    this.apiKey = apiKey;
  }

  private async call(
    url: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<Answer> {
    const response = await this.runtime.fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });

    const text = await response.text();

    // A refusal is not always JSON. An invalid key answers with the bare
    // string "Invalid credentials", so parsing strictly would turn the one
    // error a user can fix into an unreadable parse failure.
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return { httpStatus: response.status, body };
  }

  /**
   * Turn a failure status into a `BrightDataError` whose kind says who has to
   * do something about it.
   */
  private static fail(answer: Answer): BrightDataError {
    const { httpStatus, body } = answer;
    const text = typeof body === "string" ? body : "";
    const record =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

    if (httpStatus === 401 || httpStatus === 403 || /invalid credentials/i.test(text)) {
      return new BrightDataError(
        "credentials",
        "Bright Data rejected the API key. Check REDDIT_API_KEY, or create a new key " +
          "at brightdata.com under Settings, API keys.",
        httpStatus,
      );
    }

    if (/customer is not active/i.test(text)) {
      return new BrightDataError(
        "account",
        "The Bright Data account is not active. A new account takes a few minutes to " +
          "activate; check for a verification step at brightdata.com.",
        httpStatus,
      );
    }

    if (record.code === "validation_error" || httpStatus === 400) {
      // The provider names the offending field. Repeating its own sentence
      // beats inventing one, because ours would go stale the next time the
      // provider changes what it accepts.
      const fields = Array.isArray(record.errors)
        ? record.errors
            .map((entry) => (Array.isArray(entry) ? `${entry[0]}: ${entry[1]}` : String(entry)))
            .join("; ")
        : "";

      return new BrightDataError(
        "input",
        `Bright Data refused the query${fields ? ` (${fields})` : ""}.`,
        httpStatus,
      );
    }

    return new BrightDataError(
      "provider",
      `Bright Data answered ${httpStatus}${text ? `: ${text.slice(0, 200)}` : ""}.`,
      httpStatus,
    );
  }

  /**
   * Start a collection. Returns the snapshot id to poll.
   *
   * Nothing is billed here and nothing is collected yet, which is why the
   * connector can trigger and hand the wait straight back to the scheduler.
   */
  async trigger(options: {
    readonly dataset: string;
    readonly discoverBy?: "keyword" | "subreddit_url";
    readonly inputs: readonly unknown[];
    readonly limitPerInput?: number;
    readonly signal?: AbortSignal;
  }): Promise<string> {
    const params = new URLSearchParams({
      dataset_id: options.dataset,
      format: "json",
      include_errors: "true",
    });

    if (options.limitPerInput !== undefined) {
      params.set("limit_per_input", String(options.limitPerInput));
    }

    if (options.discoverBy) {
      params.set("type", "discover_new");
      params.set("discover_by", options.discoverBy);
    }

    const answer = await this.call(`${apiBase}/trigger?${params}`, {
      method: "POST",
      body: options.inputs,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (answer.httpStatus !== 200) throw BrightDataClient.fail(answer);

    const snapshotId = (answer.body as { snapshot_id?: unknown } | null)?.snapshot_id;
    if (typeof snapshotId !== "string" || snapshotId === "") {
      throw new BrightDataError(
        "provider",
        "Bright Data accepted the query but returned no snapshot id.",
        answer.httpStatus,
      );
    }

    return snapshotId;
  }

  /**
   * Where a snapshot stands, and its records once it is finished.
   *
   * Progress and download are one method because they are one question. Asking
   * progress and then downloading leaves a window in which the snapshot became
   * ready between the two calls, and a caller that trusted the first answer
   * waits a whole cycle for data it already had.
   */
  async snapshot(snapshotId: string, signal?: AbortSignal): Promise<SnapshotState> {
    const progress = await this.call(`${apiBase}/progress/${snapshotId}`, {
      ...(signal ? { signal } : {}),
    });

    if (progress.httpStatus !== 200) throw BrightDataClient.fail(progress);

    const state = progress.body as Record<string, unknown>;
    const status = state.status;

    if (status === "failed" || status === "canceled") {
      throw new BrightDataError(
        "provider",
        `Bright Data reported the collection ${String(status)}.`,
        progress.httpStatus,
      );
    }

    if (status !== "ready") {
      return { status: "pending", retryAfter: this.retryAt(defaultRetrySeconds) };
    }

    const download = await this.call(`${apiBase}/snapshot/${snapshotId}?format=json`, {
      ...(signal ? { signal } : {}),
    });

    if (download.httpStatus !== 200) throw BrightDataClient.fail(download);

    // Ready on the progress endpoint and not yet servable on the download one
    // is a state the provider really produces. It answers with an object
    // carrying its own retry hint instead of the array, so an unguarded parse
    // would read that object as zero posts and report the query finished.
    if (!Array.isArray(download.body)) {
      const message = (download.body as { message?: unknown } | null)?.message;
      return { status: "pending", retryAfter: this.retryAt(retrySecondsFrom(message)) };
    }

    const billed = state.records;

    return {
      status: "ready",
      records: download.body,
      billedRecords: typeof billed === "number" ? billed : download.body.length,
    };
  }

  private retryAt(seconds: number): Date {
    return new Date(this.runtime.now().getTime() + seconds * 1000);
  }
}
