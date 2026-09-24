/**
 * The HarvestAPI client: one transport for the LinkedIn endpoints this product
 * reads, and the refusals turned into sentences a person can act on.
 *
 * Every shape here was captured by `linkedin-fixtures/capture.mjs` on
 * 2026-09-24 (US-386). A request is billed whatever it returns — an empty
 * search moved the balance exactly as a full one did — so the unit is the
 * request, and nothing here reads the page length as the charge.
 */
import type { SourceRuntime } from "../../types.js";
import { type ProviderAnswer, ProviderError, readAnswer, retryAfterDate } from "../core.js";

const apiBase = "https://api.harvestapi.io";

export const endpoints = {
  postSearch: `${apiBase}/linkedin/post-search`,
  postComments: `${apiBase}/linkedin/post-comments`,
  /** Free: two reads with nothing between them moved no balance field. */
  account: `${apiBase}/users/my-api-user`,
} as const;

export class HarvestApiError extends ProviderError<
  "credentials" | "balance" | "input" | "rateLimit" | "provider"
> {}

/** One page, as it arrived. Parsing the elements is the connector's job. */
export interface Page {
  readonly records: readonly unknown[];
  /** The provider's own page count, when it sent one. */
  readonly totalPages?: number;
}

/** How long to wait when the provider refuses for load and names no time. */
const defaultRetrySeconds = 60;

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export interface HarvestApiClientOptions {
  readonly runtime: SourceRuntime;
  readonly apiKey: string;
}

export class HarvestApiClient {
  private readonly runtime: SourceRuntime;
  private readonly apiKey: string;

  constructor({ runtime, apiKey }: HarvestApiClientOptions) {
    this.runtime = runtime;
    this.apiKey = apiKey;
  }

  private async call(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ProviderAnswer> {
    const query = new URLSearchParams(params).toString();

    const response = await this.runtime.fetch(query ? `${endpoint}?${query}` : endpoint, {
      headers: { "X-API-Key": this.apiKey, Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });

    return readAnswer(response);
  }

  /**
   * A refusal, with the provider's own words kept.
   *
   * A refused key answers `401 { error: { error: "Invalid API key" } }`,
   * captured. The 402, 429 and 400 branches are our half of a contract the
   * provider has not shown us: no capture ran out of credit, queued past the
   * limit, or sent a parameter it refused.
   */
  private fail(answer: ProviderAnswer): HarvestApiError {
    const { httpStatus, body } = answer;
    const record = objectOf(body) ?? {};
    const said =
      typeof body === "string"
        ? body.slice(0, 200)
        : (text(objectOf(record.error)?.error) ?? text(record.error) ?? text(record.message) ?? "");

    if (httpStatus === 401 || httpStatus === 403) {
      return new HarvestApiError(
        "credentials",
        `HarvestAPI rejected the key${said ? ` (${said})` : ""}. Check HARVESTAPI_API_KEY.`,
        httpStatus,
      );
    }

    if (httpStatus === 402) {
      return new HarvestApiError(
        "balance",
        `HarvestAPI has no credit left${said ? ` (${said})` : ""}. ` +
          "Top up the account at harvestapi.io — the key is fine and retrying will not help.",
        httpStatus,
      );
    }

    if (httpStatus === 429) {
      return new HarvestApiError(
        "rateLimit",
        "HarvestAPI is refusing requests past this account's concurrency limit.",
        httpStatus,
        retryAfterDate(answer.retryAfterHeader, this.runtime.now(), defaultRetrySeconds),
      );
    }

    if (httpStatus === 400 || httpStatus === 422) {
      return new HarvestApiError(
        "input",
        `HarvestAPI refused the request${said ? ` (${said})` : ""}.`,
        httpStatus,
      );
    }

    return new HarvestApiError(
      "provider",
      `HarvestAPI answered ${httpStatus}${said ? `: ${said}` : ""}.`,
      httpStatus,
    );
  }

  private async page(
    endpoint: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Page> {
    const answer = await this.call(endpoint, params, signal);

    if (answer.httpStatus !== 200) throw this.fail(answer);

    const body = objectOf(answer.body) ?? {};
    const totalPages = objectOf(body.pagination)?.totalPages;

    return {
      records: Array.isArray(body.elements) ? body.elements : [],
      ...(typeof totalPages === "number" && Number.isFinite(totalPages) ? { totalPages } : {}),
    };
  }

  searchPosts(params: Record<string, string>, signal?: AbortSignal): Promise<Page> {
    return this.page(endpoints.postSearch, params, signal);
  }

  postComments(params: Record<string, string>, signal?: AbortSignal): Promise<Page> {
    return this.page(endpoints.postComments, params, signal);
  }

  /**
   * Check a key without spending anything. Resolving means the key works;
   * throwing means it does not, or that the provider could not be reached, and
   * the caller tells the two apart by the error's `kind`.
   */
  async probe(signal?: AbortSignal): Promise<void> {
    const answer = await this.call(endpoints.account, {}, signal);

    if (answer.httpStatus === 200) return;

    throw this.fail(answer);
  }
}
