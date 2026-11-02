/**
 * Forum pages read through Browser Use's cloud browser. US-471.
 *
 * One browser serves every page of one connector call and is stopped when the
 * call ends, an error included: a browser's first page loads the bot check's
 * scripts, and the pages after it reuse them. A page the proxy could not
 * connect to is tried once more in a new browser, which a new session id puts
 * on a new address.
 *
 * Each browser is reported once when it stops (`onBrowser`), so an
 * application can read its cost from Browser Use once that settles (US-503).
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

/** One browser, stopped: what an application needs to find its cost. */
export interface BrowserUsage {
  /** Browser Use's id for it. */
  readonly id: string;
  readonly startedAt: Date;
  readonly stoppedAt: Date;
  /** Pages it was asked for, read or not. */
  readonly pages: number;
}

export type OpenPageBrowser = (
  runtime: SourceRuntime,
  credentials: SourceCredentials,
  signal?: AbortSignal,
  onBrowser?: (browser: BrowserUsage) => void,
) => PageBrowser;

const sessionId = () => Math.random().toString(36).slice(2, 10);

/** Starts no browser until the first page is asked for. */
export const openBrowserUse: OpenPageBrowser = (runtime, credentials, signal, onBrowser) => {
  let current: { browser: CloudBrowser; tab: CdpTab; startedAt: Date; pages: number } | null = null;
  let started = 0;

  const report = (id: string, startedAt: Date, pages: number) => {
    try {
      onBrowser?.({ id, startedAt, stoppedAt: runtime.now(), pages });
    } catch (error) {
      runtime.logger.error({ err: error }, "browser usage handler failed");
    }
  };
  const start = async () => {
    const startedAt = runtime.now();
    const browser = await startCloudBrowser(runtime, credentials, sessionId(), signal);
    started += 1;
    try {
      current = { browser, tab: await CdpTab.open(browser.cdpUrl, runtime), startedAt, pages: 0 };
    } catch (error) {
      await stopCloudBrowser(runtime, credentials, browser.id);
      report(browser.id, startedAt, 0);
      throw error;
    }
    return current;
  };
  const stop = async () => {
    if (!current) return;
    const { browser, tab, startedAt, pages } = current;
    current = null;
    tab.close();
    await stopCloudBrowser(runtime, credentials, browser.id);
    report(browser.id, startedAt, pages);
  };
  const readIn = (open: NonNullable<typeof current>, url: string) => {
    open.pages += 1;
    return open.tab.read(url);
  };

  return {
    get started() {
      return started;
    },
    async read(url) {
      const open = current ?? (await start());
      const first = await readIn(open, url);
      if (first.ok || !first.connection) return first;
      runtime.logger.warn(
        { url, reason: first.reason },
        "forum page not reached through the proxy; trying a new address",
      );
      await stop();
      return readIn(await start(), url);
    },
    close: stop,
  };
};
