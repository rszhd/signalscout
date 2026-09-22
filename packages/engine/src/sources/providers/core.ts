/**
 * What every provider client shares: one error, one way to read an answer, and
 * one way to read a wait. US-334.
 *
 * The request stays in each client, because that is where they differ — how
 * the key travels and whether a body is sent. What comes back is read the same
 * way everywhere, and five copies of that had begun to drift: four
 * `Retry-After` parsers with four rules and no limit (BUG-324).
 */

/** Every way a provider call can fail, across all the providers. */
export type ProviderErrorKind =
  | "credentials"
  | "account"
  | "balance"
  | "input"
  | "rateLimit"
  | "provider";

/**
 * A provider refused or failed. Each client subclasses it with the kinds its
 * provider can produce, so a connector's `instanceof` still names one provider.
 */
export class ProviderError<Kind extends ProviderErrorKind = ProviderErrorKind> extends Error {
  constructor(
    readonly kind: Kind,
    message: string,
    readonly httpStatus: number,
    /** Set only on `rateLimit`, and only when the provider named a time. */
    readonly retryAfter?: Date,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A provider's answer, before any client has decided what it means. */
export interface ProviderAnswer {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly retryAfterHeader: string | null;
}

/**
 * Read a response. The body is JSON when it parses and text when it does not:
 * a refusal is not guaranteed to be JSON, and parsing strictly would turn the
 * one error a person can fix into an unreadable parse failure.
 */
export async function readAnswer(response: Response): Promise<ProviderAnswer> {
  const text = await response.text();

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
 * The longest wait a provider may ask for, in seconds.
 *
 * A wait books a resume poll, and that poll holds the monitor's one queued
 * slot until it runs, so every platform of the monitor waits with it. An hour
 * is the default poll interval: a longer wait is not worth honouring whole,
 * and a provider still refusing then says so again.
 */
export const maximumRetryAfterSeconds = 3600;

/**
 * When to try again, from a `Retry-After` header.
 *
 * The header is seconds or an HTTP date. A fraction is rounded up, because
 * waiting too little is the failure. Anything that is not a wait in the future
 * — no header, nonsense, zero, a time already past — takes the fallback, so a
 * poll never books itself for now and spins.
 */
export function retryAfterDate(header: string | null, now: Date, fallbackSeconds: number): Date {
  const value = header?.trim() ?? "";
  let seconds = Number.NaN;

  if (/^\d+(\.\d+)?$/.test(value)) {
    seconds = Math.ceil(Number(value));
  } else if (value) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) seconds = Math.ceil((at - now.getTime()) / 1000);
  }

  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds;
  return new Date(now.getTime() + Math.min(wait, maximumRetryAfterSeconds) * 1000);
}
