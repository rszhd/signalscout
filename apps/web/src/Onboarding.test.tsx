// @vitest-environment jsdom
/**
 * The setup gate, through the DOM. US-088.
 *
 * What this file owns is the page: it asks for both keys, it shows a step that
 * is already answered as answered rather than asking again, and it saves
 * through the two routes Connections and Models already own — so a key the
 * provider refuses is never stored and the sentence a person reads is the
 * provider's own.
 *
 * Whether the gate is shown at all is `App.tsx`'s decision and `App.test.tsx`
 * asserts it, because that is where the application is replaced.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectionsView,
  hasModelKey,
  hasProviderKey,
  type ModelsView,
  Onboarding,
} from "./Onboarding.js";
import {
  button,
  field,
  json,
  mount as mountScreen,
  type Screen,
  select,
  settle,
  setValue,
} from "./testing.js";

/** One provider, ready or not, as `/api/connections` answers for it. */
function provider(id: string, displayName: string, ready: boolean) {
  return {
    id,
    displayName,
    platforms: ["Reddit"],
    ready,
    credentials: [
      {
        name: "apiKey",
        label: "API key",
        environmentVariable: `${id.toUpperCase()}_API_KEY`,
        storedHint: ready ? "••••b3e7" : null,
        fromEnvironment: false,
        configured: ready,
      },
    ],
  };
}

function connectionsView(overrides: Partial<ConnectionsView> = {}): ConnectionsView {
  return {
    canStore: true,
    storeBlocker: null,
    providers: [provider("brightdata", "Bright Data", false), provider("apify", "Apify", false)],
    ...overrides,
  };
}

function modelsView(hasKey: boolean, overrides: Partial<ModelsView> = {}): ModelsView {
  return {
    canStore: true,
    storeBlocker: null,
    testModels: { anthropic: "claude-sonnet-5", openai: "gpt-5.6-terra" },
    keys: [],
    tasks: [
      {
        task: "classify",
        providers: ["anthropic", "openai"],
        instance: { provider: "anthropic", model: "claude-haiku-4-5", hasKey },
        fallback: { source: "instance", provider: "anthropic", hasKey },
      },
    ],
    ...overrides,
  };
}

describe("the setup gate", () => {
  let screen: Screen;
  let calls: { url: string; method: string; body: unknown }[];
  let answers: Map<string, () => Response>;
  let saved: { connections?: ConnectionsView; models?: ModelsView }[];
  let finished: number;

  beforeEach(() => {
    calls = [];
    answers = new Map();
    saved = [];
    finished = 0;
    // The sign-out button reloads, and jsdom refuses to navigate.
    vi.stubGlobal("location", { ...globalThis.location, reload: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
        const url = typeof request === "string" ? request : request.toString();
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });

        const staged = answers.get(`${init?.method ?? "GET"} ${url}`);
        if (staged) return staged();

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    await screen.unmount();
    vi.unstubAllGlobals();
  });

  async function mount(connections: ConnectionsView, models: ModelsView) {
    screen = await mountScreen(
      <Onboarding
        connections={connections}
        models={models}
        onSaved={(views) => saved.push(views)}
        onFinished={() => {
          finished += 1;
        }}
      />,
    );
    return screen;
  }

  it("asks for both keys on one page", async () => {
    await mount(connectionsView(), modelsView(false));

    expect(screen.container.textContent).toContain("1. Connect a data provider");
    expect(screen.container.textContent).toContain("2. Add a model key");
    expect(screen.container.textContent).toContain("0 of 2 done");
    // Both forms, not one after the other.
    expect(field("API key for Bright Data")).toBeTruthy();
    expect(field("Model API key")).toBeTruthy();
  });

  it("preselects SocialCrawl when this build registers it", async () => {
    // One SocialCrawl key unlocks every platform fetched through it, so a new
    // account is pointed at it first. Registration order is the fallback, not
    // the rule — the fallback is asserted above, where no SocialCrawl exists.
    await mount(
      connectionsView({
        providers: [
          provider("brightdata", "Bright Data", false),
          provider("socialcrawl", "SocialCrawl", false),
          provider("apify", "Apify", false),
        ],
      }),
      modelsView(false),
    );

    expect(select("Data provider").value).toBe("socialcrawl");
    expect(field("API key for SocialCrawl")).toBeTruthy();
  });

  it("saves a provider key through the connections route", async () => {
    // The route answers with the whole connections screen since US-090, so the
    // gate takes the whole view back rather than one refreshed provider.
    answers.set("PUT /api/connections/apify", () =>
      json(
        connectionsView({
          providers: [
            provider("brightdata", "Bright Data", false),
            provider("apify", "Apify", true),
          ],
        }),
      ),
    );

    await mount(connectionsView(), modelsView(false));

    setValue(select("Data provider"), "apify");
    await settle();
    setValue(field("API key for Apify"), "apify_key");
    await act(async () => button("Save the provider key").click());

    expect(calls).toContainEqual({
      url: "/api/connections/apify",
      method: "PUT",
      body: { credentials: { apiKey: "apify_key" } },
    });
    // Handed back to the gate, which is what re-decides whether to stay.
    expect(hasProviderKey(saved[0]?.connections as ConnectionsView)).toBe(true);
  });

  it("shows the provider's own refusal and keeps the form", async () => {
    answers.set("PUT /api/connections/brightdata", () =>
      json({ message: "Bright Data did not accept that key, so it was not saved." }, 400),
    );

    await mount(connectionsView(), modelsView(false));

    setValue(field("API key for Bright Data"), "wrong");
    await act(async () => button("Save the provider key").click());

    expect(screen.container.textContent).toContain("did not accept that key");
    expect(saved).toEqual([]);
    expect(field("API key for Bright Data")).toBeTruthy();
  });

  it("saves a model key with the model this build recommends", async () => {
    answers.set("POST /api/models/keys", () =>
      json(
        modelsView(true, {
          keys: [
            { id: "k1", name: "OpenAI key", provider: "openai", hint: "••••2410", isDefault: true },
          ],
        }),
      ),
    );

    await mount(connectionsView(), modelsView(false));

    setValue(select("Model provider"), "openai");
    await settle();
    setValue(field("Model API key"), "sk-test");
    await act(async () => button("Save the model key").click());

    expect(calls).toContainEqual({
      url: "/api/models/keys",
      method: "POST",
      body: { name: "OpenAI key", provider: "openai", apiKey: "sk-test", model: "gpt-5.6-terra" },
    });
    expect(hasModelKey(saved[0]?.models as ModelsView)).toBe(true);
  });

  it("shows an answered step as answered rather than asking again", async () => {
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(false),
    );

    expect(screen.container.textContent).toContain("Bright Data is connected");
    expect(screen.container.textContent).toContain("1 of 2 done");
    expect(() => field("API key for Bright Data")).toThrow();
    // The step that is still missing is still asked for.
    expect(field("Model API key")).toBeTruthy();
  });

  it("asks for neither key where nothing can be stored", async () => {
    await mount(
      connectionsView({
        canStore: false,
        storeBlocker: "This instance cannot store a key yet. Set ENCRYPTION_KEY.",
      }),
      modelsView(false, { canStore: false }),
    );

    expect(screen.container.textContent).toContain("Set ENCRYPTION_KEY");
    expect(() => field("API key for Bright Data")).toThrow();
    expect(() => field("Model API key")).toThrow();
  });

  it("offers the way in only once both keys are there", async () => {
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(false),
    );

    expect(() => button("Start using SignalScout")).toThrow();

    await screen.unmount();
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(true),
    );

    await act(async () => button("Start using SignalScout").click());

    expect(finished).toBe(1);
  });

  /**
   * The only way off this page, and it has to exist.
   *
   * Every other screen is behind the gate, and so is the sidebar that holds
   * the sign-out button — so somebody signed in to the wrong account on a
   * shared machine would otherwise be stuck here.
   */
  it("lets a person sign out", async () => {
    answers.set("POST /api/auth/sign-out", () => json({}));

    await mount(connectionsView(), modelsView(false));

    await act(async () => button("Sign out").click());

    expect(calls).toContainEqual({ url: "/api/auth/sign-out", method: "POST", body: null });
  });
});
