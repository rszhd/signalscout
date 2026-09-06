// @vitest-environment jsdom
/**
 * The monitor list, driven through the DOM a person uses.
 *
 * US-013 asks for two things on a screen, and both are asserted here: that a
 * poll refused by the budget says so with its reason, and that the spend and
 * what is left of the cap sit next to the monitor they belong to. The rule
 * itself belongs to `packages/core` and is asserted there; what this owns is
 * whether a person can see it and act on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMicros, Monitors, toMicros } from "./Monitors.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

const monitorId = "11111111-1111-4111-8111-111111111111";

function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: monitorId,
    name: "Teams replacing manual QA",
    sources: ["reddit"],
    paused: false,
    lastPolledAt: "2026-03-14T08:00:00.000Z",
    lastCollected: [],
    missingCredentials: [],
    budget: null,
    spend: {
      sourceMicros: 0,
      modelMicros: 0,
      totalMicros: 0,
      remainingMicros: null,
      exhausted: false,
      reason: null,
      since: "2026-03-01T00:00:00.000Z",
    },
    preFilter: {
      enabled: true,
      similarityThreshold: 0.15,
      dropped: { keyword: 0, embedding: 0 },
    },
    feedback: { good: 0, notRelevant: 0 },
    ...overrides,
  };
}

describe("the monitor list", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function show(rows: unknown[]) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitors") return json(rows);
      if (url.startsWith("/api/monitors/")) return json(rows[0]);
      throw new Error(`Unexpected request: ${url}`);
    });

    screen = await mount(<Monitors />);
    container = screen.container;
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await screen?.unmount();
    vi.unstubAllGlobals();
  });

  it("shows a disabled webhook and links to its settings", async () => {
    await show([
      monitor({ notificationIssues: ["Webhook disabled after repeated delivery failures."] }),
    ]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Webhook disabled");
    expect(
      container.querySelector(
        'a[href="#/monitors/11111111-1111-4111-8111-111111111111/notifications"]',
      ),
    ).not.toBeNull();
  });

  it("shows what a monitor spent this month, and calls it an estimate", async () => {
    await show([
      monitor({
        budget: { monthlyCapMicros: 5_000_000, onExhausted: "pause" },
        spend: {
          // Thirty cents of Reddit records and four cents of model calls.
          sourceMicros: 300_000,
          modelMicros: 40_000,
          totalMicros: 340_000,
          remainingMicros: 4_660_000,
          exhausted: false,
          reason: null,
          since: "2026-03-01T00:00:00.000Z",
        },
      }),
    ]);

    expect(container.textContent).toContain("Spent in March 2026 (estimated)");
    expect(container.textContent).toContain("$0.34");
    expect(container.textContent).toContain("$0.30");
    expect(container.textContent).toContain("$0.04");
    expect(container.textContent).toContain("$4.66");
    expect(container.textContent).toContain("Running");
  });

  it("says a poll was refused, in the server's own sentence", async () => {
    // The failure US-013 exists to prevent is a monitor that quietly stops
    // collecting. A person must be able to read why on this screen, and never
    // have to work it out from an empty inbox.
    await show([
      monitor({
        paused: true,
        budget: { monthlyCapMicros: 200_000, onExhausted: "pause" },
        spend: {
          sourceMicros: 300_000,
          modelMicros: 0,
          totalMicros: 300_000,
          remainingMicros: 0,
          exhausted: true,
          reason:
            "Stopped at the budget: this monitor has spent an estimated $0.30 of its $0.20 monthly " +
            "budget. It is not collecting, and posts it already collected are not being scored. " +
            "Raise the cap to start both again.",
          since: "2026-03-01T00:00:00.000Z",
        },
      }),
    ]);

    expect(container.textContent).toContain(
      "Stopped at the budget: this monitor has spent an estimated $0.30 of its $0.20 monthly " +
        "budget. It is not collecting, and posts it already collected are not being scored. " +
        "Raise the cap to start both again.",
    );
    // And not merely "Paused", which would send a person looking for a button
    // somebody pressed.
    expect(container.querySelector(".monitor-status")?.textContent).toBe("Budget spent");
  });

  it("shows that a monitor with no cap has none, rather than showing nothing", async () => {
    await show([monitor()]);

    expect(container.textContent).toContain("No cap set");
    expect(container.textContent).toContain("$0.00");
  });

  it("sends the cap a person typed in dollars as micro-dollars", async () => {
    await show([monitor()]);

    setValue(field("Monthly cap for Teams replacing manual QA"), "2.50");
    button("Save cap").click();
    await settle();

    const [url, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];

    expect(url).toBe(`/api/monitors/${monitorId}/budget`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      monthlyCapMicros: 2_500_000,
      onExhausted: "pause",
    });
  });

  it("refuses an amount that is not one, without asking the server", async () => {
    await show([monitor()]);
    const before = fetchMock.mock.calls.length;

    setValue(field("Monthly cap for Teams replacing manual QA"), "lots");
    button("Save cap").click();
    await settle();

    expect(fetchMock.mock.calls).toHaveLength(before);
    expect(container.textContent).toContain("Type the cap as an amount in dollars");
  });

  it("offers to remove a cap only when there is one", async () => {
    await show([monitor()]);
    expect(() => button("Remove cap")).toThrow();

    await screen.unmount();
    await show([monitor({ budget: { monthlyCapMicros: 1_000_000, onExhausted: "pause" } })]);
    expect(button("Remove cap")).toBeTruthy();
  });

  it("says how many posts each pre-filter stage kept from the model", async () => {
    // US-008 asks for this counter, and the reason is that the filter's own
    // risk is invisible everywhere else: a threshold set too high empties the
    // inbox and looks like a quiet week.
    await show([
      monitor({
        preFilter: {
          enabled: true,
          similarityThreshold: 0.15,
          dropped: { keyword: 340, embedding: 62 },
        },
      }),
    ]);

    expect(container.textContent).toContain("340 on words");
    expect(container.textContent).toContain("62 on similarity");
  });

  it("sends the threshold a person typed", async () => {
    await show([monitor()]);

    setValue(field("Similarity needed for Teams replacing manual QA"), "0.4");
    button("Save threshold").click();
    await settle();

    const [url, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];

    expect(url).toBe(`/api/monitors/${monitorId}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ preFilter: { similarityThreshold: 0.4 } });
  });

  it("refuses a similarity no cosine distance can produce, without asking the server", async () => {
    await show([monitor()]);
    const before = fetchMock.mock.calls.length;

    setValue(field("Similarity needed for Teams replacing manual QA"), "40");
    button("Save threshold").click();
    await settle();

    expect(fetchMock.mock.calls).toHaveLength(before);
    expect(container.textContent).toContain("a number between 0 and 1");
  });

  it("turns the pre-filter off, and says what that costs", async () => {
    await show([monitor()]);

    button("Turn the pre-filter off").click();
    await settle();

    const [, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ preFilter: { enabled: false } });

    await screen.unmount();
    await show([
      monitor({
        preFilter: {
          enabled: false,
          similarityThreshold: 0.15,
          dropped: { keyword: 0, embedding: 0 },
        },
      }),
    ]);

    expect(container.textContent).toContain(
      "Every collected post is sent to the model and billed.",
    );
  });

  it("offers to create one when there are no monitors", async () => {
    await show([]);

    expect(container.textContent).toContain("No monitors yet");
  });

  it("says how the matches were judged, and how many were judged at all", async () => {
    // PLAN.md's real measure of success. Nine tenths negative is a product
    // failure no other figure on this page would show.
    await show([monitor({ feedback: { good: 2, notRelevant: 18 } })]);

    expect(container.textContent).toContain("2 good, 18 not relevant of 20 judged");
  });

  it("does not report a monitor nobody judged as a monitor judged badly", async () => {
    await show([monitor()]);

    expect(container.textContent).toContain("No matches judged yet");
    expect(container.textContent).not.toContain("0 good");
  });

  it("offers the feedback as a file, so it survives a reinstall", async () => {
    await show([monitor()]);

    const link = [...container.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Export feedback"),
    );
    expect(link?.getAttribute("href")).toBe("/api/feedback/export");
  });

  it("says which provider last collected each platform, and when", async () => {
    // US-026. Once a person can change which provider fetches a platform, the
    // list has to say which one actually did — the choice can move, and this
    // is the record of what ran.
    await show([
      monitor({
        lastCollected: [
          { source: "reddit", provider: "scrapecreators", at: "2026-09-05T09:30:00.000Z" },
        ],
      }),
    ]);

    expect(container.textContent).toContain("reddit via scrapecreators");
  });
});

describe("the money on the screen", () => {
  it("keeps the places a small amount needs", () => {
    // Ten Reddit records cost $0.015. Rounded to cents that is two, and a page
    // that rounds every small number up cannot be reconciled with an invoice.
    expect(formatMicros(15_000)).toBe("$0.015");
    expect(formatMicros(15_000_000)).toBe("$15.00");
    expect(formatMicros(0)).toBe("$0.00");
  });

  it("turns dollars into micro-dollars, and refuses what is not an amount", () => {
    expect(toMicros("2.50")).toBe(2_500_000);
    expect(toMicros("0")).toBe(0);
    expect(toMicros("lots")).toBeNull();
    expect(toMicros("-1")).toBeNull();
  });
});
