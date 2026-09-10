// @vitest-environment jsdom
/**
 * The setup gate, through the DOM. US-088.
 *
 * What this file owns is the page: it asks for the two keys one step at a
 * time, it moves on when a step is answered rather than asking again, and it
 * saves through the two routes Connections and Models already own — so a key
 * the provider refuses is never stored and the sentence a person reads is the
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
  radio,
  type Screen,
  settle,
  setValue,
} from "./testing.js";

/** Pick a provider the way a person does: press its row. */
async function choose(name: string): Promise<void> {
  await act(async () => radio(`Choose ${name}`).click());
  await settle();
}

/** One provider, ready or not, as `/api/connections` answers for it. */
function provider(id: string, displayName: string, ready: boolean) {
  const websites: Record<string, string> = {
    brightdata: "https://brightdata.com/",
    scrapecreators: "https://scrapecreators.com/",
    socialcrawl: "https://www.socialcrawl.dev/",
    apify: "https://apify.com/",
  };

  return {
    id,
    displayName,
    websiteUrl: websites[id],
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

  /**
   * US-108 reversed US-088 here.
   *
   * The two questions are unrelated — one key buys the conversations and the
   * other reads them, at different companies — so both on one page is one long
   * form whose second half is noise while the first is being answered.
   */
  it("asks the first step and not the second", async () => {
    await mount(connectionsView(), modelsView(false));

    expect(screen.container.textContent).toContain("1. Connect a data provider");
    expect(screen.container.textContent).toContain("Which provider do you have an account with?");
    expect(screen.container.textContent).toContain("Step 1 of 2");

    expect(screen.container.textContent).not.toContain("2. Add a model key");
    expect(() => radio("Choose Anthropic")).toThrow();
  });

  /** The step is the first unanswered one, so a stored key moves the page. */
  it("moves to the model step when the provider key is saved", async () => {
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

    const models = modelsView(false);
    await mount(connectionsView(), models);

    await choose("Apify");
    setValue(field("API key for Apify"), "apify_key");
    await act(async () => button("Save the provider key").click());

    // The gate is handed the new view back, the way `App.tsx` hands it back.
    await screen.unmount();
    await mount(saved[0]?.connections as ConnectionsView, models);

    expect(screen.container.textContent).toContain("2. Add a model key");
    expect(screen.container.textContent).toContain("Step 2 of 2");
    expect(() => radio("Choose Apify")).toThrow();
  });

  /** An account that arrives half done starts where it left off. */
  it("starts on the model step when a provider key is already there", async () => {
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(false),
    );

    expect(screen.container.textContent).toContain("2. Add a model key");
    expect(screen.container.textContent).not.toContain("1. Connect a data provider");
  });

  /**
   * US-107 reversed US-088 here.
   *
   * A select must carry a value, so the value it started on was a guess about
   * which account the person holds — and a guess that looks like an answer is
   * how a Bright Data key is pasted into a field labelled for SocialCrawl. The
   * provider then refuses it as a wrong key, which says nothing about the real
   * mistake.
   */
  it("preselects no data provider, and asks for no key until one is picked", async () => {
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

    for (const name of ["Bright Data", "SocialCrawl", "Apify"]) {
      expect(radio(`Choose ${name}`).checked).toBe(false);
    }
    expect(() => field("API key for SocialCrawl")).toThrow();
    expect(button("Save the provider key").disabled).toBe(true);

    await choose("SocialCrawl");

    expect(field("API key for SocialCrawl")).toBeTruthy();
    expect(button("Save the provider key").disabled).toBe(false);
  });

  it("preselects no model provider, and asks for no key until one is picked", async () => {
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(false),
    );

    expect(radio("Choose Anthropic").checked).toBe(false);
    expect(radio("Choose OpenAI").checked).toBe(false);
    expect(() => field("Model API key")).toThrow();
    expect(button("Save the model key").disabled).toBe(true);

    await choose("Anthropic");

    expect(field("Model API key")).toBeTruthy();
    expect(field("Key name").value).toBe("Anthropic key");
    expect(field("Model to test with").value).toBe("claude-sonnet-5");
  });

  /**
   * What was typed belonged to the provider before it, and a key sent to the
   * wrong provider is refused as a wrong key.
   */
  it("clears what was typed when the choice changes", async () => {
    await mount(connectionsView(), modelsView(false));

    await choose("Bright Data");
    setValue(field("API key for Bright Data"), "brightdata_key");
    await choose("Apify");

    expect(field("API key for Apify").value).toBe("");
  });

  /** The platforms one key unlocks, before the key is pasted. */
  it("says what a provider fetches on its own row", async () => {
    await mount(
      connectionsView({
        providers: [
          { ...provider("socialcrawl", "SocialCrawl", false), platforms: ["Reddit", "X"] },
        ],
      }),
      modelsView(false),
    );

    const row = radio("Choose SocialCrawl").closest("label");

    expect(row?.textContent).toContain("Reddit");
    expect(row?.textContent).toContain("X");
  });

  it("links the chosen provider to its website", async () => {
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

    await choose("SocialCrawl");

    const link = screen.container.querySelector<HTMLAnchorElement>(
      '[aria-label="SocialCrawl website (opens in a new tab)"]',
    );

    expect(link?.getAttribute("href")).toBe("https://www.socialcrawl.dev/");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noopener");

    await choose("Apify");

    const updated = screen.container.querySelector<HTMLAnchorElement>(
      '[aria-label="Apify website (opens in a new tab)"]',
    );

    expect(updated?.getAttribute("href")).toBe("https://apify.com/");
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

    await choose("Apify");
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

    await choose("Bright Data");
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

    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(false),
    );

    await choose("OpenAI");
    setValue(field("Model API key"), "sk-test");
    await act(async () => button("Save the model key").click());

    expect(calls).toContainEqual({
      url: "/api/models/keys",
      method: "POST",
      body: { name: "OpenAI key", provider: "openai", apiKey: "sk-test", model: "gpt-5.6-terra" },
    });
    expect(hasModelKey(saved[0]?.models as ModelsView)).toBe(true);
  });

  /** The last screen is a confirmation: both answers, and the way in. */
  it("shows both answers once both keys are in", async () => {
    await mount(
      connectionsView({ providers: [provider("brightdata", "Bright Data", true)] }),
      modelsView(true, {
        keys: [
          { id: "k1", name: "OpenAI key", provider: "openai", hint: "••••2410", isDefault: true },
        ],
      }),
    );

    expect(screen.container.textContent).toContain("Bright Data is connected");
    expect(screen.container.textContent).toContain("OpenAI key is ready");
    expect(screen.container.textContent).toContain("Setup complete");
    expect(button("Start using SignalScout")).toBeTruthy();
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
    expect(() => radio("Choose Bright Data")).toThrow();
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
