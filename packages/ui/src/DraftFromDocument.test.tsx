// @vitest-environment jsdom
/**
 * Drafting a project from a page. US-354.
 *
 * What the part owns: it sends the address it was given, hands the draft to
 * the page and writes nothing itself, and says the server's own refusal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftFromDocument } from "./DraftFromDocument.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing/harness.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
  vi.restoreAllMocks();
});

const drafted = {
  name: "Acme QA",
  product: "A test runner",
  idealCustomer: "Small teams",
  problem: "Manual testing",
  missing: [],
  charactersRead: 1200,
  truncated: false,
};

describe("drafting from a document", () => {
  it("sends the page's address and hands the draft to the page", async () => {
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(drafted));
    const onDrafted = vi.fn();
    const onBusy = vi.fn();
    screen = await mount(
      <DraftFromDocument onDrafted={onDrafted} disabled={false} onBusy={onBusy} />,
    );

    setValue(field("Your product's address"), " https://acme.test ");
    button("Read this page").click();
    await settle();

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/describe");
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://acme.test" });
    expect(onDrafted).toHaveBeenCalledWith(drafted);
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("says the server's refusal and hands nothing over", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ message: "acme.test answered 404." }, 422),
    );
    const onDrafted = vi.fn();
    screen = await mount(
      <DraftFromDocument onDrafted={onDrafted} disabled={false} onBusy={() => {}} />,
    );

    setValue(field("Your product's address"), "https://acme.test");
    button("Read this page").click();
    await settle();

    expect(screen.container.querySelector("[role=alert]")?.textContent).toBe(
      "acme.test answered 404.",
    );
    expect(onDrafted).not.toHaveBeenCalled();
  });
});
