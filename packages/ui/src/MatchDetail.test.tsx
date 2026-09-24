// @vitest-environment jsdom
/**
 * The reading pane, driven through the DOM a person uses. US-352.
 *
 * What is asserted is the contract with the page: the buttons call back and
 * change nothing themselves, the product's own action lands beside the link,
 * and the link promises only what the platform can open. The requests behind
 * the callbacks are each application's inbox test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchDetail, type MatchDetailProps } from "./MatchDetail.js";
import type { Match } from "./match.js";
import { button, json, mount, type Screen, settle } from "./testing/harness.js";
import { match } from "./testing/matches.js";

let screen: Screen;

function props(overrides: Partial<MatchDetailProps> = {}): MatchDetailProps {
  return {
    match: match(),
    saving: false,
    judging: false,
    onSave: () => undefined,
    onJudge: () => undefined,
    onBack: () => undefined,
    ...overrides,
  };
}

async function show(overrides: Partial<MatchDetailProps> = {}) {
  screen = await mount(<MatchDetail {...props(overrides)} />);
  return screen.container;
}

beforeEach(() => {
  // The composer inside the pane reads the saved voices on mount.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ prompts: [] }));
});

afterEach(async () => {
  await screen?.unmount();
  vi.restoreAllMocks();
});

describe("the reading pane", () => {
  it("calls back with the verdict and leaves the buttons as the match says", async () => {
    const onJudge = vi.fn();
    await show({ onJudge });

    button("Not relevant").click();
    await settle();

    expect(onJudge).toHaveBeenCalledWith("not_relevant");
    expect(button("Not relevant").getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the verdict the match already has", async () => {
    await show({ match: match({ verdict: "good" }) });

    expect(button("Good lead").getAttribute("aria-pressed")).toBe("true");
  });

  it("asks to save an unsaved match, and to unsave a saved one", async () => {
    const onSave = vi.fn();
    await show({ onSave });
    button("Save for later").click();
    expect(onSave).toHaveBeenLastCalledWith(true);
    await screen.unmount();

    await show({ onSave, match: match({ saved: true }) });
    button("Saved").click();
    expect(onSave).toHaveBeenLastCalledWith(false);
  });

  it("asks to mark a match replied, and to take a mark back", async () => {
    const onReplied = vi.fn();
    await show({ onReplied });
    expect(button("Mark as replied").getAttribute("aria-pressed")).toBe("false");
    button("Mark as replied").click();
    expect(onReplied).toHaveBeenLastCalledWith(true);
    await screen.unmount();

    await show({ onReplied, match: match({ replied: true }) });
    expect(button("Replied").getAttribute("aria-pressed")).toBe("true");
    button("Replied").click();
    expect(onReplied).toHaveBeenLastCalledWith(false);
  });

  it("offers no replied button to a page that does not store the mark", async () => {
    await show();

    expect(() => button("Mark as replied")).toThrow();
  });

  it("disables the replied button while its request is in flight", async () => {
    await show({ onReplied: () => undefined, marking: true });

    expect(button("Mark as replied").disabled).toBe(true);
  });

  it("disables the buttons while the page says a request is in flight", async () => {
    await show({ saving: true, judging: true });

    expect(button("Save for later").disabled).toBe(true);
    expect(button("Good lead").disabled).toBe(true);
  });

  it("puts the product's own action beside the conversation link", async () => {
    const container = await show({
      actions: (
        <button className="secondary-button" type="button">
          Copy link
        </button>
      ),
    });

    const actions = [...(container.querySelector(".match-actions")?.children ?? [])];
    expect(actions.map((node) => node.textContent)).toEqual([
      "Open conversation ↗",
      "Copy link",
      "Save for later",
      "Describing the problem",
    ]);
  });

  it("shows a long post folded, and all of it on request", async () => {
    const long = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ");
    const container = await show({ match: match({ excerpt: long }) });
    const post = () => container.querySelector(".post-box")?.textContent ?? "";

    expect(post().endsWith("word79…")).toBe(true);
    button("Read more").click();
    await settle();
    expect(post()).toBe(long);
  });

  it("warns before the link when a reply's platform can only open the post", async () => {
    const reply: Match = match({ kind: "reply", source: "mastodon", author: "maria" });
    const container = await show({ match: reply });

    expect(container.querySelector(".link-caveat")?.textContent).toContain("@maria");
    expect(container.querySelector(".match-actions a")?.textContent).toBe("Open the post ↗");
  });
});
