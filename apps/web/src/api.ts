/**
 * One place that talks to our API.
 *
 * Every screen needs the same two things from a response: the parsed body, and
 * the server's own sentence when the request failed. The routes answer a
 * failure as `{ message }`, and a screen that showed "Request failed with 409"
 * instead would throw away the one part a person can act on.
 */

/**
 * A failure, with what the server said about it.
 *
 * An `Error` first, so every existing `catch` and `messageFor` keeps working.
 * The extra fields are for the one caller that needs to tell two refusals
 * apart rather than print them: the login, where "email not verified" sends a
 * person to their inbox and every other refusal sends them back to the form.
 * Matching on the sentence would break the day the wording changes.
 */
export class ApiError extends Error {
  readonly status: number;
  /** The machine-readable reason, when the answer carried one. US-092. */
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as
    | { message?: string; code?: string }
    | T
    | null;

  if (!response.ok) {
    const named =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof named.message === "string" ? named.message : "";
    const code = typeof named.code === "string" ? named.code : null;

    throw new ApiError(message || `The API answered ${response.status}.`, response.status, code);
  }

  return body as T;
}

/** The message to show a person when something threw. */
export function messageFor(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** The server's own reason code, when the failure carried one. */
export function codeFor(cause: unknown): string | null {
  return cause instanceof ApiError ? cause.code : null;
}
