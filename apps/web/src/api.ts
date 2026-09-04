/**
 * One place that talks to our API.
 *
 * Every screen needs the same two things from a response: the parsed body, and
 * the server's own sentence when the request failed. The routes answer a
 * failure as `{ message }`, and a screen that showed "Request failed with 409"
 * instead would throw away the one part a person can act on.
 */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { message?: string } | T | null;

  if (!response.ok) {
    const message = typeof body === "object" && body && "message" in body && body.message;
    throw new Error(message || `The API answered ${response.status}.`);
  }

  return body as T;
}

/** The message to show a person when something threw. */
export function messageFor(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
