// @vitest-environment jsdom
/**
 * The connections screen, driven through the DOM a person uses.
 *
 * Correctness-critical: credential encryption. The server half is asserted in
 * `apps/api/src/connections.test.ts`; what this file owns is whether a person
 * can see which key is set, act on it, and tell a wrong key from an
 * unreachable provider — and whether a typed key stays out of the URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connections } from "./Connections.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

function brightData(overrides: Record<string, unknown> = {}) {
  return {
    id: "brightdata",
    displayName: "Bright Data",
    platforms: ["Reddit"],
    ready: false,
    credentials: [
      {
        name: "apiKey",
        label: "Bright Data API key",
        environmentVariable: "BRIGHTDATA_API_KEY",
        storedHint: null,
        fromEnvironment: false,
        configured: false,
      },
    ],
    ...overrides,
  };
}

/**
 * One platform row, as the server sends it.
 *
 * The default has one provider, which is the deployment that sees no choice at
 * all: the screen hides the row entirely. A test about choosing passes two.
 */
function reddit(overrides: Record<string, unknown> = {}) {
  return {
    id: "reddit",
    displayName: "Reddit",
    providers: [{ id: "brightdata", displayName: "Bright Data", connected: true }],
    chosen: null,
    effective: "brightdata",
    needsChoice: false,
    blocker: null,
    ...overrides,
  };
}

function connections(overrides: Record<string, unknown> = {}) {
  return {
    canStore: true,
    storeBlocker: null,
    providers: [brightData()],
    platforms: [reddit()],
    ...overrides,
  };
}

describe("the connections screen", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Every request the screen made, so a test can assert what was not sent. */
  let calls: { url: string; method: string; body: string | null }[];

  async function show(
    body: unknown,
    replies: Record<string, () => Response | Promise<Response>> = {},
  ) {
    fetchMock.mockImplementation(async (request: string | URL | Request, init?: RequestInit) => {
      const url = typeof request === "string" ? request : request.toString();
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });

      const key = `${init?.method ?? "GET"} ${url}`;
      if (replies[key]) return replies[key]();
      if (url === "/api/connections") return json(body);
      throw new Error(`Unexpected request: ${key}`);
    });

    screen = await mount(<Connections />);
    container = screen.container;
  }

  beforeEach(() => {
    calls = [];
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("names the provider, the platform it unlocks, and the variable behind it", async () => {
    await show(connections());

    // The card is the account a person holds. It still names Reddit, because
    // Reddit is what they set out to connect.
    expect(container.textContent).toContain("Bright Data");
    expect(container.textContent).toContain("Reddit");
    expect(container.textContent).toContain("Bright Data API key");
    // The environment stays a supported way to set a key. A screen that hid it
    // would make an existing deployment look broken.
    expect(container.textContent).toContain("BRIGHTDATA_API_KEY");
    expect(container.textContent).toContain("Not connected");
  });

  it("shows a stored key as its mask and offers to remove it", async () => {
    await show(
      connections({
        providers: [
          brightData({
            ready: true,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "BRIGHTDATA_API_KEY",
                storedHint: "••••2d65",
                fromEnvironment: false,
                configured: true,
              },
            ],
          }),
        ],
      }),
    );

    expect(container.textContent).toContain("••••2d65");
    expect(() => button("Remove stored key")).not.toThrow();
  });

  it("says a key that came from the environment cannot be removed here", async () => {
    // The delete button would call a route that answers 404, because there is
    // no row. A person needs the file name, not a button that fails.
    await show(
      connections({
        providers: [
          brightData({
            ready: true,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "BRIGHTDATA_API_KEY",
                storedHint: null,
                fromEnvironment: true,
                configured: true,
              },
            ],
          }),
        ],
      }),
    );

    expect(container.textContent).toContain("BRIGHTDATA_API_KEY");
    expect(() => button("Remove stored key")).toThrow();
  });

  it("tests a key and shows that the provider accepted it", async () => {
    await show(connections(), {
      "POST /api/connections/brightdata/test": () => json({ valid: true, reason: null }),
    });

    setValue(field("Bright Data API key for Bright Data"), "brd_7f3a91c4e08b2d65");
    button("Test connection").click();
    await settle();

    expect(container.textContent).toContain("Bright Data accepted this key");
  });

  it("shows the provider's own words when it refuses the key", async () => {
    await show(connections(), {
      "POST /api/connections/brightdata/test": () =>
        json({ valid: false, reason: "Bright Data API key is not accepted." }),
    });

    setValue(field("Bright Data API key for Bright Data"), "brd_wrong");
    button("Test connection").click();
    await settle();

    expect(container.textContent).toContain("Bright Data API key is not accepted.");
  });

  it("shows the server's sentence when the provider could not be reached", async () => {
    // A refusal and an outage lead to different actions, so they must not read
    // the same on the screen.
    await show(connections(), {
      "POST /api/connections/brightdata/test": () =>
        json({ message: "Reddit could not be reached, so the key was not tested." }, 502),
    });

    setValue(field("Bright Data API key for Bright Data"), "brd_7f3a91c4e08b2d65");
    button("Test connection").click();
    await settle();

    expect(container.textContent).toContain("could not be reached");
  });

  it("saves a key in the body, never in the URL", async () => {
    // A key in a query string reaches the server's access log, the browser
    // history and every proxy in between. This is the assertion that keeps it
    // out of all three.
    const secret = "brd_7f3a91c4e08b2d65";

    await show(connections(), {
      "PUT /api/connections/brightdata": () =>
        json(
          brightData({
            ready: true,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "BRIGHTDATA_API_KEY",
                storedHint: "••••2d65",
                fromEnvironment: false,
                configured: true,
              },
            ],
          }),
        ),
    });

    setValue(field("Bright Data API key for Bright Data"), secret);
    button("Save key").click();
    await settle();

    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/connections/brightdata");
    expect(put?.url).not.toContain(secret);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ credentials: { apiKey: secret } });

    // The field is cleared once the key is stored. Leaving it filled invites a
    // second save of a value the person can no longer read back.
    expect(field("Bright Data API key for Bright Data").value).toBe("");
    expect(container.textContent).toContain("••••2d65");
  });

  it("keeps the typed key on the screen when the save was refused", async () => {
    await show(connections(), {
      "PUT /api/connections/brightdata": () =>
        json({ message: "Bright Data did not accept that key, so it was not saved." }, 400),
    });

    setValue(field("Bright Data API key for Bright Data"), "brd_wrong");
    button("Save key").click();
    await settle();

    expect(container.textContent).toContain("was not saved");
    expect(field("Bright Data API key for Bright Data").value).toBe("brd_wrong");
  });

  it("removes a stored key", async () => {
    await show(
      connections({
        providers: [
          brightData({
            ready: true,
            credentials: [
              {
                name: "apiKey",
                label: "Bright Data API key",
                environmentVariable: "BRIGHTDATA_API_KEY",
                storedHint: "••••2d65",
                fromEnvironment: false,
                configured: true,
              },
            ],
          }),
        ],
      }),
      { "DELETE /api/connections/brightdata/apiKey": () => json(brightData()) },
    );

    button("Remove stored key").click();
    await settle();

    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(container.textContent).toContain("Not connected");
  });

  it("offers no save when the instance cannot store a key, and says why", async () => {
    await show(
      connections({
        canStore: false,
        storeBlocker:
          "This instance cannot store a key yet. Set ENCRYPTION_KEY to the base64 of 32 " +
          "random bytes — `openssl rand -base64 32` — and restart.",
      }),
    );

    expect(container.textContent).toContain("ENCRYPTION_KEY");
    expect(container.textContent).toContain("openssl rand -base64 32");
    expect(() => button("Save key")).toThrow();
    // Testing spends nothing and stores nothing, so it stays offered.
    expect(() => button("Test connection")).not.toThrow();
  });

  it("says so when the connections could not be loaded", async () => {
    fetchMock.mockImplementation(async () =>
      json({ message: "The database is unreachable." }, 500),
    );

    screen = await mount(<Connections />);

    expect(screen.container.textContent).toContain("The database is unreachable.");
  });
  /**
   * Which provider fetches a platform.
   *
   * US-026 put the question here rather than on the monitor form. What this
   * file owns is whether a person sees the question only when they have one,
   * and whether pressing an answer sends the choice and nothing else.
   */
  describe("choosing which provider fetches a platform", () => {
    const bothConnected = reddit({
      providers: [
        { id: "brightdata", displayName: "Bright Data", connected: true },
        { id: "scrapecreators", displayName: "ScrapeCreators", connected: true },
      ],
      effective: null,
      needsChoice: true,
      blocker: "Bright Data and ScrapeCreators can both fetch Reddit. Choose one.",
    });

    it("shows no row at all when the platform has one provider", async () => {
      // The common deployment. There is no question, so there is nothing to
      // show, and a row saying "your only option is your only option" is
      // furniture on a screen about keys.
      await show(connections());

      expect(container.textContent).not.toContain("Which provider fetches what");
    });

    it("asks which provider, and says why nothing is collecting yet", async () => {
      await show(connections({ platforms: [bothConnected] }));

      expect(container.textContent).toContain("Which provider fetches what");
      expect(container.textContent).toContain("ScrapeCreators");
      expect(container.textContent).toContain("Choose one");
    });

    it("sends the choice, and shows what the server sent back", async () => {
      const chosen = {
        ...bothConnected,
        chosen: "scrapecreators",
        effective: "scrapecreators",
        needsChoice: false,
        blocker: null,
      };

      await show(connections({ platforms: [bothConnected] }), {
        "PUT /api/platforms/reddit/provider": () => json(connections({ platforms: [chosen] })),
      });

      const options = [...container.querySelectorAll("input[type=radio]")] as HTMLInputElement[];
      const scrapeCreators = options[1];

      if (!scrapeCreators) throw new Error("The second provider has no option to press.");

      scrapeCreators.click();
      await settle();

      expect(calls).toContainEqual({
        url: "/api/platforms/reddit/provider",
        method: "PUT",
        body: JSON.stringify({ provider: "scrapecreators" }),
      });
      expect(container.textContent).toContain("Fetched by ScrapeCreators");
    });

    it("offers no option for a provider with no key here", async () => {
      // Choosing it would record a choice nothing can run. The row says the
      // key is missing instead, which is the action.
      await show(
        connections({
          platforms: [
            reddit({
              providers: [
                { id: "brightdata", displayName: "Bright Data", connected: true },
                { id: "scrapecreators", displayName: "ScrapeCreators", connected: false },
              ],
              needsChoice: false,
            }),
          ],
        }),
      );

      const options = [...container.querySelectorAll("input[type=radio]")] as HTMLInputElement[];

      expect(options.map((option) => option.disabled)).toEqual([false, true]);
      expect(container.textContent).toContain("No key here");
    });
  });
});
