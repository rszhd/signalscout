// @vitest-environment jsdom
/**
 * The Models screen, through the DOM. US-068.
 *
 * The claims are the ones a person's money depends on. An empty field means
 * "use this instance's", and the screen has to say what that is or the empty
 * state is a mystery. A blank key box on save must leave the stored key alone,
 * because the form posts every field every time and erasing a key is silent —
 * it looks like a poll that scored nothing.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Models } from "./Models.js";
import { button, field, json, mount, type Screen, select, settle, setValue } from "./testing.js";

function view(overrides: Record<string, unknown> = {}) {
  return {
    canStore: true,
    storeBlocker: null,
    pricedModels: ["claude-haiku-4-5", "gpt-5.6-luna"],
    tasks: [
      {
        task: "classify",
        title: "Scoring posts",
        what: "Reads a post and scores it against the monitor.",
        note: "The most expensive call this product makes.",
        providers: ["openai", "anthropic"],
        instance: { provider: "anthropic", model: "claude-haiku-4-5" },
        provider: null,
        model: null,
        baseUrl: null,
        inputPriceMicros: null,
        outputPriceMicros: null,
        keyHint: null,
        ...overrides,
      },
    ],
  };
}

describe("the models screen", () => {
  let screen: Screen;
  let fetched: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetched = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetched);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("says what an empty field falls back to", async () => {
    screen = await mount(<Models />);

    expect(select("Scoring posts provider").value).toBe("");
    expect(screen.container.textContent).toContain("This instance's (anthropic)");
    expect(field("Scoring posts model").placeholder).toBe("claude-haiku-4-5");
    expect(field("Scoring posts API key").placeholder).toBe("This instance's key");
  });

  it("carries the reason a triage model should be the cheap one", async () => {
    screen = await mount(<Models />);

    // The measurement, not just the field. Somebody picking a triage model
    // without it picks the wrong one, and US-030 is what measured that.
    expect(screen.container.textContent).toContain("The most expensive call this product makes.");
  });

  it("shows a stored key as a mask and never as a value", async () => {
    fetched.mockResolvedValue(json(view({ keyHint: "••••abcd", provider: "openai" })));
    screen = await mount(<Models />);

    expect(field("Scoring posts API key").placeholder).toBe("••••abcd");
    expect(field("Scoring posts API key").value).toBe("");
    expect(screen.container.textContent).toContain("Leave this empty to keep it");
  });

  /**
   * The one that would be silent if it broke. A form posting every field would
   * otherwise erase the key each time somebody changed a model, and nothing
   * would say so until the next poll scored nothing.
   */
  it("sends no key at all when the key box is left empty", async () => {
    fetched.mockResolvedValue(json(view({ keyHint: "••••abcd" })));
    screen = await mount(<Models />);

    setValue(field("Scoring posts model"), "gpt-5.6-luna");
    await act(async () => button("Save").click());
    await settle();

    const [url, init] = fetched.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/models/classify");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.6-luna");
    expect("apiKey" in body).toBe(false);
  });

  it("sends the key when one is typed", async () => {
    screen = await mount(<Models />);

    setValue(field("Scoring posts API key"), "sk-mine");
    await act(async () => button("Save").click());
    await settle();

    const [, init] = fetched.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).apiKey).toBe("sk-mine");
  });

  it("offers the way back to the instance's settings only when there is one", async () => {
    screen = await mount(<Models />);
    expect(() => button("Use this instance's")).toThrow();

    await screen.unmount();
    fetched.mockResolvedValue(json(view({ provider: "openai" })));
    screen = await mount(<Models />);

    await act(async () => button("Use this instance's").click());
    await settle();

    // The last call, because the remount above made a second GET first.
    const [url, init] = fetched.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/models/classify");
    expect(init.method).toBe("DELETE");
  });

  it("says so when the instance cannot store a key at all", async () => {
    fetched.mockResolvedValue(
      json({ ...view(), canStore: false, storeBlocker: "Set ENCRYPTION_KEY and restart." }),
    );
    screen = await mount(<Models />);

    expect(screen.container.textContent).toContain("Set ENCRYPTION_KEY and restart.");
    expect(field("Scoring posts API key").disabled).toBe(true);
  });
});
