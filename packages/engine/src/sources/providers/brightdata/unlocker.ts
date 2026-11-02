/**
 * Bright Data's Web Unlocker: one page, fetched past the site's bot check.
 * US-470.
 *
 * `POST https://api.brightdata.com/request` with `{zone, url, format: "raw"}`
 * and the key as a Bearer token, read from Bright Data's documentation on
 * 2026-10-30. The answer is the page itself.
 *
 * Two refusals arrive as a 200 and must not be read as a page, both seen on
 * 2026-10-30: Bright Data's own ("Residential Failed (bad_endpoint): …
 * not available for immediate residential (no KYC) access mode in accordance
 * with robots.txt"), and a site's "Please refresh to continue" check that
 * Bright Data did not pass. Bright Data bills only a request that succeeds,
 * so neither costs a unit.
 */
import type { SourceCredentials, SourceRuntime } from "../../types.js";
import { ProviderError, retryAfterDate } from "../core.js";

const endpoint = "https://api.brightdata.com/request";

export type UnlockerErrorKind = "credentials" | "input" | "balance" | "rateLimit" | "provider";

export class UnlockerError extends ProviderError<UnlockerErrorKind> {}

/** A page, or why there is none. A refusal is an answer, not an error. */
export type UnlockerAnswer =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: string };

/** Where a refusal answered as a 200 shows itself. */
function refusalIn(body: string): string | null {
  if (/^(Residential Failed|Proxy Error)/.test(body)) return body.slice(0, 200);
  // Bright Data at times answers a 200 with nothing in it, for a page that
  // comes back whole when asked again; a browser shows a page that never
  // loaded the same way. Taken as a page, it loses the forum. BUG-481.
  if (/^\s*(?:<html><head><\/head><body><\/body><\/html>)?\s*$/.test(body)) {
    return "the site answered with an empty page";
  }
  return challengeIn(body) ? "the site answered with a challenge page" : null;
}

/**
 * Whether an HTML page is a bot check rather than the site.
 *
 * Read from a challenge's title or script only, never the words of a real
 * page: Cloudflare's "Just a moment…" and "Checking your browser", a
 * proof-of-work script, and a plain "Please refresh to continue", all seen
 * through Bright Data on 2026-10-30, and a host's "One moment, please…" seen
 * through a browser on 2026-10-31. A thread titled "Checking your browser
 * cache…" would be taken for one too; such a title was judged rare enough.
 * Cloudflare's "Enable JavaScript and cookies to continue" can follow a long
 * script, so it is looked for further down; it came titled "Challenge - <site>"
 * through a browser on 2026-11-03.
 */
export function challengeIn(body: string): boolean {
  const head = body.slice(0, 4000);
  const title = head.match(/<title[^>]*>([^<]*)</i)?.[1] ?? "";
  return (
    /Please refresh to continue/.test(head) ||
    /Enable JavaScript and cookies to continue/.test(body.slice(0, 20_000)) ||
    /^(Just a moment|Checking your browser|Attention Required|One moment, please)/i.test(
      title.trim(),
    ) ||
    /POW_CHALLENGE|cf-chl-/.test(head)
  );
}

/** Exported for the tests: the refusals that arrive as a 200. */
export { refusalIn };

export async function fetchThroughUnlocker(
  runtime: SourceRuntime,
  credentials: SourceCredentials,
  url: string,
  signal?: AbortSignal,
): Promise<UnlockerAnswer> {
  const { apiKey, unlockerZone } = credentials;
  if (!apiKey || !unlockerZone) {
    throw new UnlockerError(
      "credentials",
      "Enter a Bright Data API key and a Web Unlocker zone.",
      0,
    );
  }

  const response = await runtime.fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ zone: unlockerZone, url, format: "raw" }),
    ...(signal ? { signal } : {}),
  });
  const body = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new UnlockerError("credentials", "Bright Data refused the API key.", response.status);
  }
  if (response.status === 402) {
    throw new UnlockerError(
      "balance",
      "The Bright Data account has no balance left.",
      response.status,
    );
  }
  if (response.status === 429) {
    throw new UnlockerError(
      "rateLimit",
      "Bright Data asked us to slow down.",
      response.status,
      retryAfterDate(response.headers.get("retry-after"), runtime.now(), 60),
    );
  }
  if (response.status === 400) {
    // A wrong zone name lands here too: the page cannot be asked for at all.
    throw new UnlockerError(
      "input",
      `Bright Data refused the request: ${body.slice(0, 200)}`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new UnlockerError(
      "provider",
      `Bright Data answered ${response.status}.`,
      response.status,
    );
  }

  const refusal = refusalIn(body);
  return refusal ? { ok: false, reason: refusal } : { ok: true, body };
}
