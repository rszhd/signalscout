/**
 * One tab of a remote Chromium, driven over the DevTools protocol. US-471.
 *
 * The few commands a forum read needs, over Node's own WebSocket, so the
 * engine takes no browser library. A page is read once it has loaded and no
 * bot check is left on it: a check runs its script, passes, and loads the
 * page again, which can interrupt a read, so a read that meets a navigation
 * waits and tries again.
 *
 * Images, fonts and media are refused: they are most of a page's bytes, and
 * the proxy bills by the byte. A site's `alert()` is dismissed, or it would
 * hold the tab.
 */
import type { SourceRuntime } from "../../types.js";
import { refusalIn } from "../brightdata/unlocker.js";

const commandTimeoutMs = 30_000;
const loadTimeoutMs = 45_000;
/** A bot check passes within seconds in a real browser, or not at all. */
const challengeWaitMs = 25_000;
const challengePollMs = 2_500;
/** How long a page may stay half-parsed before it is read anyway. */
const parseWaitMs = 15_000;
const parsePollMs = 500;

/** A page, a page still behind a check, or no connection through the proxy. */
export type BrowserAnswer =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: string; readonly connection: boolean };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpTab {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly waiters = new Set<{ event: string; resolve(): void }>();
  private sessionId = "";

  private constructor(
    private readonly socket: WebSocket,
    private readonly runtime: SourceRuntime,
  ) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => {
      for (const [, call] of this.pending) {
        clearTimeout(call.timer);
        call.reject(new Error("the browser connection closed"));
      }
      this.pending.clear();
    });
  }

  static async open(cdpUrl: string, runtime: SourceRuntime): Promise<CdpTab> {
    const socket = new WebSocket(cdpUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("no connection to the browser")), {
        once: true,
      });
    });
    const tab = new CdpTab(socket, runtime);
    const { targetId } = (await tab.send("Target.createTarget", { url: "about:blank" })) as {
      targetId: string;
    };
    const { sessionId } = (await tab.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };
    tab.sessionId = sessionId;
    await tab.send("Page.enable");
    await tab.send("Fetch.enable", {
      patterns: ["Image", "Font", "Media"].map((resourceType) => ({ resourceType })),
    });
    return tab;
  }

  /** The page at `url`, once loaded and past any bot check. */
  async read(url: string): Promise<BrowserAnswer> {
    const loaded = this.next("Page.domContentEventFired", loadTimeoutMs);
    const navigated = (await this.send("Page.navigate", { url })) as { errorText?: string };
    if (navigated.errorText) {
      return { ok: false, reason: navigated.errorText, connection: true };
    }
    await loaded;
    let body = await this.parsedHtml();
    for (let waited = 0; refusalIn(body) && waited < challengeWaitMs; waited += challengePollMs) {
      await this.runtime.sleep(challengePollMs);
      body = await this.parsedHtml();
    }
    // Chromium's own page for a connection that failed, the proxy's included.
    if (/<body[^>]*class="neterror"/.test(body.slice(0, 3000))) {
      return { ok: false, reason: "the proxy did not connect to the site", connection: true };
    }
    const refusal = refusalIn(body);
    return refusal ? { ok: false, reason: refusal, connection: false } : { ok: true, body };
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }

  /**
   * The document's HTML once the browser has parsed all of it.
   *
   * A passed check loads the real page, and the load event above was the
   * check's: read at once, the new page can still be arriving. Etsy's came
   * back cut off inside its <head> (BUG-526). A page still loading after
   * `parseWaitMs` is read as it stands.
   */
  private async parsedHtml(): Promise<string> {
    for (let waited = 0; waited < parseWaitMs; waited += parsePollMs) {
      const state = await this.readyState();
      if (state !== "loading") break;
      await this.runtime.sleep(parsePollMs);
    }
    return this.html();
  }

  /** `document.readyState`, or null when there is no document to ask yet. */
  private async readyState(): Promise<string | null> {
    try {
      const answer = (await this.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      return typeof answer.result?.value === "string" ? answer.result.value : null;
    } catch {
      return null;
    }
  }

  /** The document's HTML; a navigation in progress is waited out. */
  private async html(): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const answer = (await this.send("Runtime.evaluate", {
          expression: "document.documentElement.outerHTML",
          returnByValue: true,
        })) as { result?: { value?: unknown } };
        if (typeof answer.result?.value === "string") return answer.result.value;
      } catch (error) {
        if (attempt >= 9) throw error;
      }
      if (attempt >= 9) throw new Error("the browser returned no document");
      await this.runtime.sleep(1_000);
    }
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const message = {
      id,
      method,
      params,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the browser did not answer ${method}`));
      }, commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  /** Resolves at the event, or after `timeoutMs` without it. */
  private next(event: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiter = {
        event,
        resolve: () => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.resolve, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private receive(data: string): void {
    const message = JSON.parse(data) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result ?? {});
      return;
    }
    if (message.method === "Fetch.requestPaused") {
      this.send("Fetch.failRequest", {
        requestId: message.params?.requestId,
        errorReason: "BlockedByClient",
      }).catch(() => {});
    } else if (message.method === "Page.javascriptDialogOpening") {
      this.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
    }
    for (const waiter of this.waiters) if (waiter.event === message.method) waiter.resolve();
  }
}
