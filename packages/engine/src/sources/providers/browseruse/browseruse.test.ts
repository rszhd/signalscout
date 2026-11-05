import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../logger.js";
import type { SourceRuntime } from "../../types.js";
import { CdpTab } from "./cdp.js";
import { BrowserUseError, proxyFor, startCloudBrowser, stopCloudBrowser } from "./cloud.js";
import { type BrowserUsage, openBrowserUse } from "./pages.js";

const credentials = {
  apiKey: "bu-key",
  proxyHost: "proxy.example",
  proxyPort: "1000",
  proxyUsername: "user",
  proxyPassword: "secret_country-US",
};

function runtimeWith(
  fetch: typeof globalThis.fetch = async () => new Response("{}"),
): SourceRuntime {
  return {
    fetch,
    now: () => new Date("2026-10-31T01:00:00.000Z"),
    sleep: () => Promise.resolve(),
    logger: createLogger({ level: "silent", name: "browseruse-test" }),
  };
}

describe("Browser Use's cloud browser", () => {
  it("starts a browser on our proxy only, with a session of its own, and stops it", async () => {
    const asked: { url: string; method: string; body: unknown; key: string | null }[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      asked.push({
        url: String(url),
        method: String(init?.method),
        body: JSON.parse(String(init?.body)),
        key: new Headers(init?.headers).get("x-browser-use-api-key"),
      });
      return new Response(JSON.stringify({ id: "b1", cdpUrl: "wss://cdp.example/b1" }));
    };
    const runtime = runtimeWith(fetch);

    const browser = await startCloudBrowser(runtime, credentials, "abc123");
    await stopCloudBrowser(runtime, credentials, browser.id);

    expect(browser).toEqual({ id: "b1", cdpUrl: "wss://cdp.example/b1" });
    expect(asked).toEqual([
      {
        url: "https://api.browser-use.com/api/v4/browsers",
        method: "POST",
        body: {
          customProxy: {
            host: "proxy.example",
            port: 1000,
            username: "user",
            password: "secret_country-US_session-abc123",
          },
          // Browser Use's own proxy off: it bills ten times ours. US-503.
          proxyCountryCode: null,
        },
        key: "bu-key",
      },
      {
        url: "https://api.browser-use.com/api/v4/browsers/b1",
        method: "PATCH",
        body: { action: "stop" },
        key: "bu-key",
      },
    ]);
  });

  it("refuses to start without a proxy, and names an empty account", async () => {
    const { proxyPassword: _password, ...withoutProxy } = credentials;
    await expect(startCloudBrowser(runtimeWith(), withoutProxy, "s")).rejects.toMatchObject({
      kind: "credentials",
    });
    const broke = runtimeWith(async () => new Response("no credit", { status: 402 }));
    const refused = await startCloudBrowser(broke, credentials, "s").catch((error) => error);
    expect(refused).toBeInstanceOf(BrowserUseError);
    expect(refused.kind).toBe("balance");
  });

  it("never throws when a stop fails: it runs after an error too", async () => {
    const down = runtimeWith(async () => {
      throw new Error("no connection");
    });
    await expect(stopCloudBrowser(down, credentials, "b1")).resolves.toBeUndefined();
  });

  it("keeps one address per session in the password by default", () => {
    expect(proxyFor(credentials, "abc123")).toEqual({
      port: 1000,
      password: "secret_country-US_session-abc123",
    });
  });

  it("keeps one address per port when the credentials say so", () => {
    const byPort = { ...credentials, proxyPort: "10000", proxySession: "port" };
    const first = proxyFor(byPort, "abc123");

    expect(first.password).toBe("secret_country-US");
    expect(first.port).toBeGreaterThanOrEqual(10000);
    expect(first.port).toBeLessThanOrEqual(10999);
    expect(proxyFor(byPort, "abc123")).toEqual(first);
  });
});

/**
 * A remote Chromium as the DevTools protocol shows it: answers each command,
 * fires the load event after a navigation, and serves `pages` in turn to each
 * read of the document. It records every command it was sent.
 */
class FakeChromium {
  static current: FakeChromium;
  readonly sent: { method: string; params: Record<string, unknown> }[] = [];
  private readonly listeners: Record<string, ((event: { data?: string }) => void)[]> = {};

  constructor(
    readonly url: string,
    private readonly pages: string[] = [],
    private readonly navigationError?: string,
    /** `document.readyState` for each time it is asked, then "complete". */
    private readonly states: string[] = [],
  ) {
    FakeChromium.current = this;
    setTimeout(() => this.emit("open", {}), 0);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  send(data: string) {
    const { id, method, params } = JSON.parse(data) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    this.sent.push({ method, params });
    const answer = (result: unknown) =>
      setTimeout(() => this.emit("message", { data: JSON.stringify({ id, result }) }), 0);
    if (method === "Target.createTarget") return answer({ targetId: "t1" });
    if (method === "Target.attachToTarget") return answer({ sessionId: "s1" });
    if (method === "Page.navigate") {
      if (this.navigationError) return answer({ frameId: "f", errorText: this.navigationError });
      answer({ frameId: "f" });
      // The page asks for an image, and calls alert(), as it loads.
      this.event("Fetch.requestPaused", { requestId: "r1", resourceType: "Image" });
      this.event("Page.javascriptDialogOpening", { message: "Welcome!" });
      return this.event("Page.domContentEventFired", {});
    }
    if (method === "Runtime.evaluate" && params.expression === "document.readyState") {
      return answer({ result: { value: this.states.shift() ?? "complete" } });
    }
    if (method === "Runtime.evaluate") {
      const page = this.pages.shift();
      return answer(page === undefined ? {} : { result: { value: page } });
    }
    return answer({});
  }

  close() {
    this.emit("close", {});
  }

  private event(method: string, params: Record<string, unknown>) {
    setTimeout(() => this.emit("message", { data: JSON.stringify({ method, params }) }), 0);
  }

  private emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const forumPage = "<html><head><title>Watch Forum</title></head><body>threads</body></html>";
const challenge = "<html><head><title>Just a moment...</title></head><body></body></html>";

describe("a tab of the cloud browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  function chromium(pages: string[], navigationError?: string, states: string[] = []) {
    vi.stubGlobal(
      "WebSocket",
      class extends FakeChromium {
        constructor(url: string) {
          super(url, pages, navigationError, states);
        }
      },
    );
  }

  it("reads a page only once the browser has parsed all of it (BUG-526)", async () => {
    // After the check passed, Etsy's page was still arriving, cut off in <head>.
    chromium([forumPage], undefined, ["loading", "loading", "interactive"]);
    const tab = await CdpTab.open("wss://cdp.example/b1", runtimeWith());

    expect(await tab.read("https://shop.example/")).toEqual({ ok: true, body: forumPage });
    const asked = FakeChromium.current.sent.filter(
      (call) => call.params.expression === "document.readyState",
    );
    expect(asked).toHaveLength(3);
  });

  it("reads a page that never finishes parsing, after the wait", async () => {
    chromium(
      [forumPage],
      undefined,
      Array.from({ length: 100 }, () => "loading"),
    );
    const tab = await CdpTab.open("wss://cdp.example/b1", runtimeWith());

    expect(await tab.read("https://shop.example/")).toEqual({ ok: true, body: forumPage });
  });

  it("reads a page once its bot check has passed, refusing images and dismissing alerts", async () => {
    chromium([challenge, challenge, forumPage]);
    const tab = await CdpTab.open("wss://cdp.example/b1", runtimeWith());

    const answer = await tab.read("https://watchuseek.com/");

    expect(answer).toEqual({ ok: true, body: forumPage });
    const sent = FakeChromium.current.sent;
    expect(sent.find((call) => call.method === "Fetch.enable")?.params).toEqual({
      patterns: [{ resourceType: "Image" }, { resourceType: "Font" }, { resourceType: "Media" }],
    });
    expect(sent).toContainEqual({
      method: "Fetch.failRequest",
      params: { requestId: "r1", errorReason: "BlockedByClient" },
    });
    expect(sent).toContainEqual({
      method: "Page.handleJavaScriptDialog",
      params: { accept: false },
    });
  });

  it("gives up on a check that does not pass, and says so", async () => {
    chromium(Array.from({ length: 20 }, () => challenge));
    const tab = await CdpTab.open("wss://cdp.example/b1", runtimeWith());

    expect(await tab.read("https://watchuseek.com/")).toEqual({
      ok: false,
      reason: "the site answered with a challenge page",
      connection: false,
    });
  });

  it("waits out a page that is still empty, and refuses one that stays empty", async () => {
    const empty = "<html><head></head><body></body></html>";
    chromium([empty, forumPage]);
    const tab = await CdpTab.open("wss://cdp.example/b1", runtimeWith());
    expect(await tab.read("https://watchuseek.com/")).toEqual({ ok: true, body: forumPage });

    chromium(Array.from({ length: 20 }, () => empty));
    const stays = await CdpTab.open("wss://cdp.example/b1", runtimeWith());
    expect(await stays.read("https://watchuseek.com/")).toEqual({
      ok: false,
      reason: "the site answered with an empty page",
      connection: false,
    });
  });

  it("waits out a navigation, and calls a failed proxy a connection error", async () => {
    chromium([]);
    const empty = await CdpTab.open("wss://x", runtimeWith());
    await expect(empty.read("https://a.example/")).rejects.toThrow("no document");

    chromium([], "net::ERR_TUNNEL_CONNECTION_FAILED");
    const tunnel = await (await CdpTab.open("wss://x", runtimeWith())).read("https://a.example/");
    expect(tunnel).toEqual({
      ok: false,
      reason: "net::ERR_TUNNEL_CONNECTION_FAILED",
      connection: true,
    });

    chromium(['<html><body class="neterror">This site can’t be reached</body></html>']);
    const unreached = await (await CdpTab.open("wss://x", runtimeWith())).read(
      "https://a.example/",
    );
    expect(unreached).toMatchObject({ ok: false, connection: true });
  });

  it("tries a page the proxy did not reach once more, in a new browser", async () => {
    const pages = ['<html><body class="neterror">no</body></html>', forumPage];
    vi.stubGlobal(
      "WebSocket",
      class extends FakeChromium {
        constructor(url: string) {
          super(url, [pages.shift() ?? ""]);
        }
      },
    );
    const asked: string[] = [];
    let browsers = 0;
    const runtime = runtimeWith(async (url, init) => {
      asked.push(`${init?.method} ${String(url)}`);
      browsers += init?.method === "POST" ? 1 : 0;
      return new Response(JSON.stringify({ id: `b${browsers}`, cdpUrl: `wss://cdp/b${browsers}` }));
    });

    const used: BrowserUsage[] = [];
    const browser = openBrowserUse(runtime, credentials, undefined, (one) => used.push(one));
    const answer = await browser.read("https://a.example/");
    await browser.close();

    expect(answer).toEqual({ ok: true, body: forumPage });
    expect(browser.started).toBe(2);
    // Each browser told once, when it stopped, with the pages it was asked for.
    const at = new Date("2026-10-31T01:00:00.000Z");
    expect(used).toEqual([
      { id: "b1", startedAt: at, stoppedAt: at, pages: 1 },
      { id: "b2", startedAt: at, stoppedAt: at, pages: 1 },
    ]);
    expect(asked).toEqual([
      "POST https://api.browser-use.com/api/v4/browsers",
      "PATCH https://api.browser-use.com/api/v4/browsers/b1",
      "POST https://api.browser-use.com/api/v4/browsers",
      "PATCH https://api.browser-use.com/api/v4/browsers/b2",
    ]);
  });
});
