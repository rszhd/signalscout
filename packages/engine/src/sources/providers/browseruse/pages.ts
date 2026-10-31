/**
 * Forum pages read through Browser Use's cloud browser. US-471.
 *
 * One browser serves every page of one connector call and is stopped when the
 * call ends, an error included: a browser's first page loads the bot check's
 * scripts, and the pages after it reuse them. A page the proxy could not
 * connect to is tried once more in a new browser, which a new session id puts
 * on a new address.
 */
import type { SourceCredentials, SourceRuntime } from "../../types.js";
import { type BrowserAnswer, CdpTab } from "./cdp.js";
import { type CloudBrowser, startCloudBrowser, stopCloudBrowser } from "./cloud.js";

/** What a forum read needs from a browser, so a test can hand it a fake. */
export interface PageBrowser {
  read(url: string): Promise<BrowserAnswer>;
  /** Browsers started so far: each is billed a minute at least. */
  readonly started: number;
  close(): Promise<void>;
}

export type OpenPageBrowser = (
  runtime: SourceRuntime,
  credentials: SourceCredentials,
  signal?: AbortSignal,
) => PageBrowser;

const sessionId = () => Math.random().toString(36).slice(2, 10);

/** Starts no browser until the first page is asked for. */
export const openBrowserUse: OpenPageBrowser = (runtime, credentials, signal) => {
  let current: { browser: CloudBrowser; tab: CdpTab } | null = null;
  let started = 0;

  const start = async () => {
    const browser = await startCloudBrowser(runtime, credentials, sessionId(), signal);
    started += 1;
    try {
      current = { browser, tab: await CdpTab.open(browser.cdpUrl, runtime) };
    } catch (error) {
      await stopCloudBrowser(runtime, credentials, browser.id);
      throw error;
    }
    return current;
  };
  const stop = async () => {
    if (!current) return;
    const { browser, tab } = current;
    current = null;
    tab.close();
    await stopCloudBrowser(runtime, credentials, browser.id);
  };

  return {
    get started() {
      return started;
    },
    async read(url) {
      const open = current ?? (await start());
      const first = await open.tab.read(url);
      if (first.ok || !first.connection) return first;
      runtime.logger.warn(
        { url, reason: first.reason },
        "forum page not reached through the proxy; trying a new address",
      );
      await stop();
      return (await start()).tab.read(url);
    },
    close: stop,
  };
};
