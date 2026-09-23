// @vitest-environment jsdom
/**
 * The inbox's filter bar, driven through the DOM. US-370.
 *
 * What the bar decides and a page cannot get wrong: the picker appears only
 * with a choice, the badge counts only filters a person can see, the order
 * leaves with the Saved view, and every change is a callback. What the page
 * does with them is each application's inbox test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxFilters, type InboxFiltersProps } from "./InboxFilters.js";
import { activeFilters } from "./match.js";
import { button, mount, type Screen, select, settle, setValue } from "./testing/harness.js";

let screen: Screen;

afterEach(async () => {
  await screen?.unmount();
});

const two = [
  { id: "m1", name: "Reddit weekly" },
  { id: "m2", name: "X daily" },
];

function props(overrides: Partial<InboxFiltersProps> = {}): InboxFiltersProps {
  return {
    saved: false,
    onSaved: () => undefined,
    monitors: two,
    monitorId: "",
    onMonitor: () => undefined,
    order: "rank",
    onOrder: () => undefined,
    minScore: 0,
    onMinScore: () => undefined,
    showDismissed: false,
    onShowDismissed: () => undefined,
    onClear: () => undefined,
    ...overrides,
  };
}

const picker = () => screen.container.querySelector('select[aria-label="Monitor"]');

describe("the inbox filter bar", () => {
  it("offers the monitor picker only when there is a choice", async () => {
    screen = await mount(<InboxFilters {...props()} />);
    expect(picker()).not.toBeNull();
    await screen.unmount();

    screen = await mount(
      <InboxFilters {...props({ monitors: [two[0] ?? { id: "", name: "" }] })} />,
    );
    expect(picker()).toBeNull();
  });

  it("counts the filters a person can see, and offers to clear them", async () => {
    const onClear = vi.fn();
    screen = await mount(
      <InboxFilters {...props({ monitorId: "m1", minScore: 70, showDismissed: true, onClear })} />,
    );

    expect(button("Filters · 3").getAttribute("aria-expanded")).toBe("false");
    button("Filters · 3").click();
    await settle();
    expect(button("Filters · 3").getAttribute("aria-expanded")).toBe("true");
    button("Clear filters").click();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("does not count a monitor nobody can choose", () => {
    expect(
      activeFilters({
        monitors: [{ id: "m1" }],
        monitorId: "m1",
        minScore: 0,
        showDismissed: false,
      }),
    ).toBe(0);
  });

  it("hides the order on the Saved view, which has its own", async () => {
    screen = await mount(<InboxFilters {...props({ saved: true })} />);

    expect(screen.container.querySelector('select[aria-label="Order"]')).toBeNull();
    expect(button("Saved").getAttribute("aria-pressed")).toBe("true");
  });

  it("calls back with each change", async () => {
    const onMinScore = vi.fn();
    const onOrder = vi.fn();
    screen = await mount(<InboxFilters {...props({ onMinScore, onOrder })} />);

    setValue(select("Minimum score"), "85");
    setValue(select("Order"), "newest");
    await settle();

    expect(onMinScore).toHaveBeenCalledWith(85);
    expect(onOrder).toHaveBeenCalledWith("newest");
  });
});
