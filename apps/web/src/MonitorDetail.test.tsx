// @vitest-environment jsdom
/**
 * One monitor's page, driven through the DOM a person uses. US-109.
 *
 * Everything here was inside a card on the list until US-109, and the cases
 * moved with it unchanged wherever the behaviour did not change. US-013 asks
 * for two of them: that a poll refused by the budget says so with its reason,
 * and that the spend and what is left of the cap sit next to the monitor they
 * belong to. The rule itself belongs to `packages/core`; what this owns is
 * whether a person can see it and act on it.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorDetail } from "./MonitorDetail.js";
import {
  monitor,
  testMonitorId as monitorId,
  poll,
  testProjectId as projectId,
} from "./monitor-fixtures.js";
import { everyDay, summarise, weekdays } from "./schedule.js";
import { button, field, json, mount, type Screen, select, settle, setValue } from "./testing.js";

describe("one monitor's page", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** The page, with this monitor and the polls it has recorded. */
  async function show(row: unknown, polls: unknown[] = []) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url.includes("/polls")) return json(polls);
      if (url.startsWith("/api/monitors/")) return json(row);
      throw new Error(`Unexpected request: ${url}`);
    });

    screen = await mount(
      <MonitorDetail monitorId={monitorId} projectId={projectId} />,
      `/projects/${projectId}/monitors/${monitorId}`,
    );
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

  it("names the monitor and links back to the list", async () => {
    await show(monitor());

    expect(container.querySelector("h1")?.textContent).toBe("Teams replacing manual QA");
    expect(container.querySelector(`a[href="/projects/${projectId}/monitors"]`)).not.toBeNull();
  });

  it("reads the one monitor rather than the whole list", async () => {
    await show(monitor());

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/monitors/${monitorId}`);
  });

  it("says so plainly when the monitor cannot be read", async () => {
    fetchMock.mockImplementation(async () => json({ message: "No monitor has that id." }, 404));

    screen = await mount(
      <MonitorDetail monitorId={monitorId} projectId={projectId} />,
      `/projects/${projectId}/monitors/${monitorId}`,
    );
    container = screen.container;

    expect(container.textContent).toContain("This monitor could not be loaded");
    expect(container.textContent).toContain("No monitor has that id.");
  });

  describe("what it is doing", () => {
    it("says what the last poll did, and when the next one is due", async () => {
      const due = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await show(monitor({ lastPolledAt: due, lastPoll: poll() }));

      expect(container.textContent).toContain("Last poll found no posts");
      expect(container.textContent).toContain("due now");
    });

    it("says a monitor that has never polled has never polled", async () => {
      await show(monitor({ lastPolledAt: null, lastPoll: null }));

      expect(container.textContent).toContain("This monitor has not polled yet.");
    });

    it("says how many matches came out, and how many nobody has opened", async () => {
      await show(monitor({ matches: { total: 20, unread: 3 } }));

      expect(container.textContent).toContain("20 matches found, 3 unread");
    });

    /**
     * The list carries one poll per monitor and this page carries fifty of
     * one, so this is the screen that loads them — and it loads them as it
     * opens, because reading them is why somebody came here.
     */
    it("loads the poll history without anybody opening a section", async () => {
      await show(monitor({ lastPoll: poll() }), [
        poll({ id: "older", outcome: "collected", postsReturned: 12, postsNew: 4, units: 2 }),
      ]);

      const asked = fetchMock.mock.calls.filter(([url]) => String(url).includes("/polls"));

      expect(asked).toHaveLength(1);
      expect(String(asked[0]?.[0])).toContain(`/api/monitors/${monitorId}/polls`);
      expect(container.querySelector(".poll-history")?.textContent).toContain("12 posts, 4 new");
    });

    it("says there are no polls rather than showing an empty list", async () => {
      await show(monitor(), []);

      expect(container.textContent).toContain("No polls recorded yet.");
    });
  });

  describe("pausing and resuming", () => {
    it("pauses the monitor and reads it back", async () => {
      await show(monitor());

      button("Pause").click();
      await settle();

      const [url, init] = fetchMock.mock.calls.find(([called]) =>
        String(called).endsWith("/pause"),
      ) as [string, RequestInit];

      expect(url).toBe(`/api/monitors/${monitorId}/pause`);
      expect(init.method).toBe("POST");
    });

    it("offers Resume on a monitor somebody paused", async () => {
      await show(monitor({ paused: true }));

      expect(button("Resume")).toBeTruthy();
    });
  });

  describe("what it has spent", () => {
    it("shows what a monitor spent this month, and calls it an estimate", async () => {
      await show(
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
      );

      expect(container.textContent).toContain("Spent in March 2026 (estimated)");
      expect(container.textContent).toContain("$0.34");
      expect(container.textContent).toContain("$0.30");
      expect(container.textContent).toContain("$0.04");
      expect(container.textContent).toContain("$4.66");
      expect(container.textContent).toContain("Running");
    });

    it("says a poll was refused, in the server's own sentence", async () => {
      // The failure US-013 exists to prevent is a monitor that quietly stops
      // collecting. A person must be able to read why, and never have to work
      // it out from an empty inbox.
      await show(
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
      );

      expect(container.textContent).toContain(
        "Stopped at the budget: this monitor has spent an estimated $0.30 of its $0.20 monthly " +
          "budget. It is not collecting, and posts it already collected are not being scored. " +
          "Raise the cap to start both again.",
      );
      // And not merely "Paused", which would send a person looking for a
      // button somebody pressed.
      expect(container.querySelector(".monitor-status")?.textContent).toBe("Budget spent");
    });

    it("shows that a monitor with no cap has none, rather than showing nothing", async () => {
      await show(monitor());

      expect(container.textContent).toContain("No cap set");
      expect(container.textContent).toContain("$0.00");
    });

    it("sends the cap a person typed in dollars as micro-dollars", async () => {
      await show(monitor());

      setValue(field("Monthly cap for Teams replacing manual QA"), "2.50");
      button("Save cap").click();
      await settle();

      const [url, init] = fetchMock.mock.calls.find(
        ([called, options]) =>
          String(called).endsWith("/budget") && (options as RequestInit)?.method === "PUT",
      ) as [string, RequestInit];

      expect(url).toBe(`/api/monitors/${monitorId}/budget`);
      expect(JSON.parse(String(init.body))).toEqual({
        monthlyCapMicros: 2_500_000,
        onExhausted: "pause",
      });
    });

    it("refuses an amount that is not one, without asking the server", async () => {
      await show(monitor());
      const before = fetchMock.mock.calls.length;

      setValue(field("Monthly cap for Teams replacing manual QA"), "lots");
      button("Save cap").click();
      await settle();

      expect(fetchMock.mock.calls).toHaveLength(before);
      expect(container.textContent).toContain("Type the cap as an amount in dollars");
    });

    it("offers to remove a cap only when there is one", async () => {
      await show(monitor());
      expect(() => button("Remove cap")).toThrow();

      await screen.unmount();
      await show(monitor({ budget: { monthlyCapMicros: 1_000_000, onExhausted: "pause" } }));
      expect(button("Remove cap")).toBeTruthy();
    });
  });

  describe("which posts the AI reads", () => {
    /**
     * The counter US-008 asked for, in words a person who did not build it can
     * read. The stage's own risk is invisible everywhere else: a filter
     * dropping most of what it finds empties the inbox and looks like a quiet
     * week.
     */
    it("says what was skipped before the AI read it, and why", async () => {
      await show(
        monitor({
          preFilter: {
            enabled: true,
            similarityThreshold: 0.15,
            dropped: { keyword: 340, embedding: 62, triage: 8 },
            read: 46,
          },
        }),
      );

      expect(container.textContent).toContain("The AI read 46 of 456 posts found");
      expect(container.textContent).toContain("The other 410 were skipped");
      expect(container.textContent).toContain("340 did not use your words");
      expect(container.textContent).toContain("62 were not about your subject");
      expect(container.textContent).toContain("8 read as someone answering rather than asking");
    });

    /** A stage that dropped nothing is left out rather than reported as zero. */
    it("names only the stages that skipped something", async () => {
      await show(
        monitor({
          preFilter: {
            enabled: true,
            similarityThreshold: 0.15,
            dropped: { keyword: 12, embedding: 0, triage: 0 },
            read: 3,
          },
        }),
      );

      expect(container.textContent).toContain("The AI read 3 of 15 posts found");
      expect(container.textContent).toContain("12 did not use your words");
      expect(container.textContent).not.toContain("0 were not about your subject");
    });

    /**
     * The threshold left the screen, and this is the case that keeps it off.
     *
     * It is a research dial: 0.15 came from one monitor and five posts, a
     * value set too high deletes leads with no row and no bill, and on every
     * platform measured the stage has dropped almost nothing. It stays
     * editable through the API, where the person changing it knows what it is.
     */
    it("asks for no similarity number", async () => {
      await show(monitor());

      expect(container.textContent).not.toContain("Similarity");
      expect(document.querySelector('[aria-label^="Similarity needed"]')).toBeNull();
      expect(() => button("Save threshold")).toThrow();
    });

    it("turns the pre-filter off, and says what that costs", async () => {
      await show(monitor());

      const everyPost = [...document.querySelectorAll<HTMLLabelElement>(".reading-option")].find(
        (option) => option.textContent?.includes("Every post found"),
      );
      everyPost?.querySelector("input")?.click();
      await settle();

      const [, init] = fetchMock.mock.calls.find(
        ([, options]) => (options as RequestInit)?.method === "PATCH",
      ) as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ preFilter: { enabled: false } });

      await screen.unmount();
      await show(
        monitor({
          preFilter: {
            enabled: false,
            similarityThreshold: 0.15,
            dropped: { keyword: 0, embedding: 0, triage: 0 },
            read: 9,
          },
        }),
      );

      expect(container.textContent).toContain(
        "Every post this monitor collects is read by the AI, and every one is billed.",
      );
    });
  });

  describe("what the person thought of it", () => {
    it("says how the matches were judged, and how many were judged at all", async () => {
      // PLAN.md's real measure of success. Nine tenths negative is a product
      // failure no other figure on this page would show.
      await show(monitor({ feedback: { good: 2, notRelevant: 18 } }));

      expect(container.textContent).toContain("2 good, 18 not relevant of 20 judged");
    });

    it("does not report a monitor nobody judged as a monitor judged badly", async () => {
      await show(monitor());

      expect(container.textContent).toContain("No matches judged yet");
      expect(container.textContent).not.toContain("0 good");
    });
  });

  it("shows a disabled webhook and links to its settings", async () => {
    await show(
      monitor({ notificationIssues: ["Webhook disabled after repeated delivery failures."] }),
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Webhook disabled");
    expect(
      container.querySelector(
        `a[href="/projects/${projectId}/monitors/${monitorId}/notifications"]`,
      ),
    ).not.toBeNull();
  });

  it("says which provider last collected each platform, and when", async () => {
    // US-026. Once a person can change which provider fetches a platform, the
    // screen has to say which one actually did — the choice can move, and this
    // is the record of what ran.
    const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await show(monitor({ lastCollected: [{ source: "reddit", provider: "scrapecreators", at }] }));

    const row = container.querySelector(".collection-list li");

    expect(row?.textContent).toContain("Reddit");
    expect(row?.textContent).toContain("ScrapeCreators");
    // Relative, because the question here is "did it run recently?". The exact
    // moment is the tooltip, for the person reconciling a bill.
    expect(row?.textContent).toContain("2 hours ago");
    expect(row?.querySelector("time")?.getAttribute("title")).toBe(new Date(at).toLocaleString());
  });

  /**
   * When a monitor runs. US-041.
   *
   * The column existed since US-007 and no screen ever wrote to it, so every
   * monitor anybody made polled hourly for ever. It is the largest cost dial
   * in the product.
   */
  describe("choosing when a monitor runs", () => {
    /**
     * The hints are computed from the same arithmetic the projection uses, so
     * a hint and a quote cannot disagree. BUG-005 was exactly that
     * disagreement at a larger scale, and the first draft of this list said
     * "about 240 polls a month" where the arithmetic gives 244.
     */
    it("says what a schedule costs, from the arithmetic rather than by hand", () => {
      expect(summarise(3_600, everyDay)).toContain("731");
      expect(summarise(3 * 3_600, everyDay)).toContain("244");
      expect(summarise(6 * 3_600, everyDay)).toContain("122");
      expect(summarise(12 * 3_600, everyDay)).toContain("61");
      // Five sevenths of hourly, which is the whole reason days exist.
      expect(summarise(3_600, weekdays)).toContain("522");
      // And a set no rule names, which the old control could not express.
      expect(summarise(3_600, [1, 3, 5])).toContain("313");
    });

    it("reads a day set back as a phrase rather than as numbers", () => {
      expect(summarise(3_600, everyDay)).toBe("Polls every hour — about 731 polls a month.");
      expect(summarise(86_400, weekdays)).toContain("on weekdays");
      expect(summarise(86_400, [0, 6])).toContain("at weekends");
      expect(summarise(86_400, [1, 3, 5])).toContain("on Mon, Wed and Fri");
      expect(summarise(86_400, [2])).toContain("on Tues");
    });

    it("asks how often and which days as two questions", async () => {
      await show(monitor());

      expect(select("How often")).toBeDefined();
      expect(select("Which days")).toBeDefined();

      // The count is in polls a month, because that is the unit a person
      // spends. Leaving them to work it out is how a monitor ends up hourly.
      expect(container.textContent).toContain("polls a month");
    });

    function patchBody() {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/monitors/") && (init as RequestInit)?.method === "PATCH",
      );

      const [, init] = call as [string, RequestInit];

      return JSON.parse(String(init.body));
    }

    it("sends both the interval and the days, because a day list is the point", async () => {
      await show(monitor());

      await act(async () => setValue(select("Which days"), "weekdays"));
      await settle();

      expect(patchBody()).toEqual({
        pollIntervalSeconds: 3_600,
        pollDays: [1, 2, 3, 4, 5],
      });
    });

    it("changes the rate without touching the days", async () => {
      await show(monitor({ pollIntervalSeconds: 3_600, pollDays: [1, 3, 5] }));

      await act(async () => setValue(select("How often"), "86400"));
      await settle();

      // The two questions are independent: picking a rate must not quietly
      // reset a day set somebody chose.
      expect(patchBody()).toEqual({ pollIntervalSeconds: 86_400, pollDays: [1, 3, 5] });
    });

    /**
     * A day set no named rule covers. US-041's control could not express one
     * at all — nine welded pairs, none of them Monday, Wednesday and Friday.
     */
    it("lets a person tick the days themselves", async () => {
      await show(monitor({ pollDays: [1, 2, 3, 4, 5] }));

      const saturday = container.querySelector<HTMLButtonElement>('[aria-label="Saturday"]');
      await act(async () => saturday?.click());
      await settle();

      expect(patchBody()).toEqual({
        pollIntervalSeconds: 3_600,
        pollDays: [1, 2, 3, 4, 5, 6],
      });
    });

    /**
     * A monitor with no days is never due, and the API refuses one — so the
     * last tick cannot be cleared here either. Turning a click into an error
     * nobody asked for is the alternative.
     */
    it("will not let the last day be turned off", async () => {
      await show(monitor({ pollDays: [3] }));

      const wednesday = container.querySelector<HTMLButtonElement>('[aria-label="Wednesday"]');

      expect(wednesday?.disabled).toBe(true);
    });

    /**
     * A monitor edited by hand can sit between two choices. The screen says
     * what it actually does rather than rounding it to the nearest and
     * changing it silently the next time anybody saves.
     */
    it("describes a schedule that matches no choice rather than rounding it", async () => {
      await show(monitor({ pollIntervalSeconds: 900, pollDays: [2, 4] }));

      expect(container.textContent).toContain("Custom: every 15 minutes");
      expect(container.textContent).toContain("Tue, Thu");
    });

    it("says which timezone the days are counted in", async () => {
      await show(monitor({ pollTimezone: "Asia/Kuala_Lumpur" }));

      expect(container.textContent).toContain("Asia/Kuala_Lumpur");
    });
  });
});
