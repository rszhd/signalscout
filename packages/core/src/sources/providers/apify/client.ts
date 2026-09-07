/**
 * The Apify client, shared by every actor this provider runs.
 *
 * Correctness-critical: the budget guard. The failure this file has to avoid is
 * **reporting a run as free when it was not**. Apify charges a pay-per-event
 * actor *after* the run finishes, so the run object at the moment its status
 * changes carries only the start event. US-056 measured it: a run that had just
 * returned ten posts reported `usageTotalUsd: 0.00005`, and $0.02005 a few
 * seconds later. A guard fed the first number would price every poll at five
 * thousandths of a cent and refuse nothing, for ever, silently.
 *
 * Every shape below was captured from a live account by
 * `linkedin-fixtures/capture.mjs` on 2026-09-07, not read from the
 * documentation.
 *
 * The run model is Bright Data's rather than ScrapeCreators': start a run, poll
 * it, then read its dataset. It is far quicker — 3.3 to 10.5 seconds against
 * minutes — but the shape is the same, and so is BUG-001's lesson. A poll that
 * is interrupted and resumed must finish the run it started. Starting a second
 * one buys the same posts again at full price, which is why the run id travels
 * in the connector's cursor.
 */
import type { Logger } from "../../../logger.js";
import type { SourceRuntime } from "../../types.js";

const apiBase = "https://api.apify.com/v2";

/**
 * The actors this provider runs for us.
 *
 * `~` rather than `/` is Apify's own separator inside a path segment.
 */
export const actors = {
  /**
   * HarvestAPI's LinkedIn post search. US-056.
   *
   * The one actor of its author's sixteen that finds a stranger: the others
   * need a profile, a company or a post URL first. It needs no LinkedIn cookie
   * and no LinkedIn account, which is its own headline claim and the reason it
   * was chosen over a provider that reaches LinkedIn through Google's index.
   */
  linkedInPostSearch: "harvestapi~linkedin-post-search",
} as const;

/**
 * A refusal from Apify, already turned into a sentence a user can act on.
 *
 * `credentials` and `input` are separated because a user told to check their
 * token when the input was malformed will check their token, find it correct,
 * and have nowhere left to go. In a bring-your-own-keys product this sentence
 * is the whole support channel.
 */
export class ApifyError extends Error {
  constructor(
    readonly kind: "credentials" | "input" | "rateLimit" | "provider",
    message: string,
    readonly httpStatus: number,
    /** Set only on `rateLimit`, and only when the provider named a time. */
    readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

/** A run that has been started but has not finished. */
export interface PendingRun {
  readonly runId: string;
  readonly status: string;
}

/** A finished run: its items, and what it actually cost. */
export interface FinishedRun {
  readonly runId: string;
  readonly status: string;
  /** The dataset as it arrived. Parsing it is the connector's job. */
  readonly records: readonly unknown[];
  /**
   * What the run cost, in micro-dollars, from the settled bill.
   *
   * Never derived from the item count. A run that returns nothing is still
   * charged a `no-result` event and a start event, and counting posts alone
   * would report an empty poll as free — which is the direction that spends
   * past a cap.
   */
  readonly costMicros: number;
  /** The provider's per-event breakdown, for a log line worth reading. */
  readonly chargedEventCounts: Readonly<Record<string, number>>;
}

/** How long to wait when the provider rate-limits us and names no time. */
const defaultRetrySeconds = 60;

/**
 * How many times to ask again for a bill that is still moving, and how long to
 * wait between asks.
 *
 * The measured settle took a few seconds. Ten tries at two seconds is generous
 * against that and still bounded: an unsettled bill is something to report,
 * not to hang a worker on.
 */
const settleAttempts = 10;
const settleIntervalMs = 2000;

/** A run that is still working. Anything else has stopped, well or badly. */
const runningStatuses = new Set(["READY", "RUNNING"]);

interface Answer {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly retryAfterHeader: string | null;
}

export interface ApifyClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiToken: string;
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class ApifyClient {
  private readonly runtime: SourceRuntime;
  private readonly apiToken: string;

  constructor({ runtime, apiToken }: ApifyClientOptions) {
    this.runtime = runtime;
    this.apiToken = apiToken;
  }

  private async call(
    path: string,
    {
      method = "GET",
      body,
      signal,
    }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<Answer> {
    const response = await this.runtime.fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });

    const text = await response.text();

    // A refusal is not guaranteed to be JSON. Parsing strictly would turn the
    // one error a user can fix into an unreadable parse failure.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    return {
      httpStatus: response.status,
      body: parsed,
      retryAfterHeader: response.headers.get("retry-after"),
    };
  }

  /**
   * Turn a failure into an `ApifyError` whose kind says who has to do something
   * about it.
   *
   * The provider's own message is repeated rather than replaced. Ours would go
   * stale the next time Apify changes what it accepts, and theirs names the
   * offending field.
   */
  private fail(answer: Answer): ApifyError {
    const { httpStatus, body } = answer;
    const error = objectOf(objectOf(body)?.error);
    const message = typeof error?.message === "string" ? error.message : "";
    const text = typeof body === "string" ? body : message;

    if (httpStatus === 401 || httpStatus === 403) {
      return new ApifyError(
        "credentials",
        // "User was not found or authentication token is not valid" is what
        // Apify said on 2026-09-07. Repeating it and then saying where to fix
        // it is more use than either alone.
        `Apify rejected the API token${text ? ` (${text})` : ""}. ` +
          "Check APIFY_API_TOKEN, or create a new token in the Apify console.",
        httpStatus,
      );
    }

    // Never measured. No capture run has been rate-limited, so this branch is
    // our half of a contract the provider has not yet shown us.
    if (httpStatus === 429) {
      return new ApifyError(
        "rateLimit",
        "Apify is rate-limiting this token.",
        httpStatus,
        this.retryAt(answer.retryAfterHeader),
      );
    }

    if (httpStatus === 400 || httpStatus === 404) {
      return new ApifyError(
        "input",
        `Apify refused the run${text ? ` (${text})` : ""}.`,
        httpStatus,
      );
    }

    return new ApifyError(
      "provider",
      `Apify answered ${httpStatus}${text ? `: ${text.slice(0, 200)}` : ""}.`,
      httpStatus,
    );
  }

  /**
   * Start an actor run and return its id, without waiting for it.
   *
   * Separate from reading it, because those are the two halves a resumed poll
   * has to be able to do independently. The connector stores the id and comes
   * back; nothing here loops until a run is done.
   */
  async startRun(actor: string, input: unknown, signal?: AbortSignal): Promise<PendingRun> {
    const answer = await this.call(`/acts/${actor}/runs`, {
      method: "POST",
      body: input,
      ...(signal ? { signal } : {}),
    });

    if (answer.httpStatus >= 400) throw this.fail(answer);

    const data = objectOf(objectOf(answer.body)?.data);
    const runId = typeof data?.id === "string" ? data.id : undefined;

    if (!runId) {
      throw new ApifyError(
        "provider",
        "Apify started a run and did not say which one, so it cannot be read back.",
        answer.httpStatus,
      );
    }

    return { runId, status: typeof data?.status === "string" ? data.status : "READY" };
  }

  /** Whether a run has stopped, without reading anything else about it. */
  async runStatus(runId: string, signal?: AbortSignal): Promise<string> {
    const answer = await this.call(`/actor-runs/${runId}`, { ...(signal ? { signal } : {}) });

    if (answer.httpStatus >= 400) throw this.fail(answer);

    const data = objectOf(objectOf(answer.body)?.data);
    return typeof data?.status === "string" ? data.status : "UNKNOWN";
  }

  static isRunning(status: string): boolean {
    return runningStatuses.has(status);
  }

  /**
   * Read a finished run: its dataset, and what it cost once the bill settled.
   *
   * The waiting is the point. See the header — the run object is not final at
   * the moment its status changes, and this is the only place that knows it.
   */
  async readRun(runId: string, signal?: AbortSignal): Promise<FinishedRun> {
    const settled = await this.settle(runId, signal);
    const data = objectOf(objectOf(settled.body)?.data) ?? {};

    const datasetId = typeof data.defaultDatasetId === "string" ? data.defaultDatasetId : undefined;
    const status = typeof data.status === "string" ? data.status : "UNKNOWN";

    const records = datasetId ? await this.readDataset(datasetId, signal) : [];

    return {
      runId,
      status,
      records,
      costMicros: this.costOf(data),
      chargedEventCounts: (objectOf(data.chargedEventCounts) ?? {}) as Record<string, number>,
    };
  }

  private async readDataset(datasetId: string, signal?: AbortSignal): Promise<readonly unknown[]> {
    const answer = await this.call(`/datasets/${datasetId}/items`, {
      ...(signal ? { signal } : {}),
    });

    if (answer.httpStatus >= 400) throw this.fail(answer);

    return Array.isArray(answer.body) ? answer.body : [];
  }

  /**
   * Ask for the run until its bill stops growing.
   *
   * Stops on two zero readings as well as on a repeat, because a run really can
   * cost nothing — a refused input never charges — and waiting ten rounds for a
   * zero to confirm itself would make every failed poll twenty seconds slower.
   */
  private async settle(runId: string, signal?: AbortSignal): Promise<Answer> {
    let answer = await this.call(`/actor-runs/${runId}`, { ...(signal ? { signal } : {}) });
    if (answer.httpStatus >= 400) throw this.fail(answer);

    let previous = this.usdOf(answer);
    let zeros = previous === 0 ? 1 : 0;

    for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
      await this.runtime.sleep(settleIntervalMs);

      const polled = await this.call(`/actor-runs/${runId}`, { ...(signal ? { signal } : {}) });
      if (polled.httpStatus >= 400) throw this.fail(polled);

      answer = polled;
      const usd = this.usdOf(polled);

      if (usd > 0 && usd === previous) return answer;
      if (usd === 0 && ++zeros >= 2) return answer;

      previous = usd;
    }

    // Ten rounds and it is still moving. Report what we have rather than wait
    // longer: an under-reported bill is the danger, and this is the last
    // number the provider gave us, not a guess.
    warnOnce(
      this.runtime.logger,
      "apify-bill-unsettled",
      "an Apify run's bill was still changing after ten checks; recording the last figure",
    );

    return answer;
  }

  private usdOf(answer: Answer): number {
    const data = objectOf(objectOf(answer.body)?.data);
    return numberOf(data?.usageTotalUsd) ?? 0;
  }

  /**
   * What the run cost, in micro-dollars.
   *
   * `usageTotalUsd` is the whole bill — the actor's per-item events *and* the
   * start event *and* a `no-result` charge when nothing matched. Reading the
   * item count instead would report an empty poll as free, and an empty poll is
   * charged $0.00105.
   *
   * Rounded up, because a fraction of a micro-dollar cannot be stored and
   * rounding down is the direction that spends past a cap.
   */
  private costOf(data: Record<string, unknown>): number {
    const usd = numberOf(data.usageTotalUsd);

    if (usd === undefined) {
      warnOnce(
        this.runtime.logger,
        "apify-usage-missing",
        "an Apify run reported no usageTotalUsd; its cost is recorded as zero and the cap is that much blinder",
      );
      return 0;
    }

    return Math.ceil(usd * 1_000_000);
  }

  /**
   * Check a token without spending anything.
   *
   * Reading the account is the cheapest call Apify has, and it needs no actor,
   * so a wrong token is refused before anything could be run. Measured on
   * 2026-09-07: a bad token answers 401 `user-or-token-not-found` and no run
   * starts.
   *
   * Resolving means the token works. Throwing means it does not, or that the
   * provider could not be reached — and those are different answers, which is
   * why the caller reads the error's `kind` rather than a boolean.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const answer = await this.call("/users/me", { ...(signal ? { signal } : {}) });

    if (answer.httpStatus === 200) return;

    throw this.fail(answer);
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
  logger.warn({ provider: "apify" }, message);
}
