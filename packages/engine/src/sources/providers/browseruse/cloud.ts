/**
 * Browser Use's cloud browser: started, and stopped. US-471.
 *
 * `POST /api/v4/browsers` starts a Chromium that Browser Use keeps past bot
 * checks, and answers with its id and a `cdpUrl` to drive it; `PATCH
 * /api/v4/browsers/{id}` with `{"action": "stop"}` stops it. The key goes in
 * `X-Browser-Use-API-Key`, with no "Bearer". Read from Browser Use's
 * documentation on 2026-10-31.
 *
 * A browser bills by the minute until it is stopped, and closing the CDP
 * connection does not stop it: every start has a stop.
 *
 * Only with our own proxy (`customProxy`): Browser Use's own costs about ten
 * times more a page, so without one this module refuses to start a browser.
 */
import type { SourceCredentials, SourceRuntime } from "../../types.js";
import { ProviderError, retryAfterDate } from "../core.js";

const api = "https://api.browser-use.com/api/v4/browsers";

export type BrowserUseErrorKind = "credentials" | "balance" | "rateLimit" | "provider";

export class BrowserUseError extends ProviderError<BrowserUseErrorKind> {}

export interface CloudBrowser {
  readonly id: string;
  readonly cdpUrl: string;
}

/** The credential fields a browser needs: the key, and the proxy's four. */
export function hasBrowserCredentials(credentials: SourceCredentials | undefined): boolean {
  return Boolean(
    credentials?.apiKey &&
      credentials.proxyHost &&
      credentials.proxyPort &&
      credentials.proxyUsername &&
      credentials.proxyPassword,
  );
}

/**
 * A residential proxy keeps one address for a session named in its password
 * (Evomi: `<password>_session-<id>`), so each browser gets an id of its own and
 * a retry gets a new address.
 */
export function sessionPassword(password: string, session: string): string {
  return `${password}_session-${session}`;
}

function headers(apiKey: string): Record<string, string> {
  return { "X-Browser-Use-API-Key": apiKey, "Content-Type": "application/json" };
}

async function refusal(response: Response, runtime: SourceRuntime): Promise<BrowserUseError> {
  const body = (await response.text()).slice(0, 200);
  if (response.status === 401 || response.status === 403)
    return new BrowserUseError("credentials", "Browser Use refused the API key.", response.status);
  if (response.status === 402)
    return new BrowserUseError(
      "balance",
      "The Browser Use account has no credit left.",
      response.status,
    );
  if (response.status === 429)
    return new BrowserUseError(
      "rateLimit",
      "Browser Use has no browser free: too many at once.",
      response.status,
      retryAfterDate(response.headers.get("retry-after"), runtime.now(), 60),
    );
  return new BrowserUseError(
    "provider",
    `Browser Use answered ${response.status}: ${body}`,
    response.status,
  );
}

export async function startCloudBrowser(
  runtime: SourceRuntime,
  credentials: SourceCredentials,
  session: string,
  signal?: AbortSignal,
): Promise<CloudBrowser> {
  if (!hasBrowserCredentials(credentials)) {
    throw new BrowserUseError(
      "credentials",
      "Enter a Browser Use API key and a proxy's host, port, user and password.",
      0,
    );
  }
  const { apiKey = "", proxyHost, proxyPort, proxyUsername, proxyPassword = "" } = credentials;
  const response = await runtime.fetch(api, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      customProxy: {
        host: proxyHost,
        port: Number(proxyPort),
        username: proxyUsername,
        password: sessionPassword(proxyPassword, session),
      },
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await refusal(response, runtime);
  const started = (await response.json()) as Partial<CloudBrowser>;
  if (!started.id || !started.cdpUrl)
    throw new BrowserUseError("provider", "Browser Use started a browser with no address.", 200);
  return { id: started.id, cdpUrl: started.cdpUrl };
}

/** Stops the browser. Never throws: it runs after an error too. */
export async function stopCloudBrowser(
  runtime: SourceRuntime,
  credentials: SourceCredentials,
  id: string,
): Promise<void> {
  try {
    const response = await runtime.fetch(`${api}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers(credentials.apiKey ?? ""),
      body: JSON.stringify({ action: "stop" }),
    });
    if (!response.ok)
      runtime.logger.error(
        { browserId: id, status: response.status },
        "Browser Use browser not stopped: it bills until its timeout",
      );
  } catch (error) {
    runtime.logger.error(
      { browserId: id, err: error },
      "Browser Use browser not stopped: it bills until its timeout",
    );
  }
}
