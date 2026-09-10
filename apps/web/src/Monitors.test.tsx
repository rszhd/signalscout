// @vitest-environment jsdom
/**
 * The monitor list, driven through the DOM a person uses.
 *
 * What this file owns after US-109 is the *list*: the five columns, the
 * filters, the grouping, and the one action a person takes from a row. What a
 * monitor is and what it has spent belongs to `MonitorDetail.test.tsx`, and
 * the rule underneath each figure belongs to `packages/core`, where it is
 * asserted against real Postgres.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupsOf, Monitors } from "./Monitors.js";
import {
  monitor,
  testMonitorId as monitorId,
  poll,
  testProjectId as projectId,
} from "./monitor-fixtures.js";
import { button, field, json, mount, type Screen, settle, setValue } from "./testing.js";

/** The rows of every table on the screen, the way a person counts them. */
function rows(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>(".monitor-table tbody tr")];
}

describe("the monitor list", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function show(list: unknown[], project = projectId) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitors") return json(list);
      if (url.startsWith("/api/monitors/")) return json(list[0]);
      throw new Error(`Unexpected request: ${url}`);
    });

    screen = await mount(<Monitors projectId={project} />, `/projects/${project}/monitors`);
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

  describe("the five columns", () => {
    it("names the columns a person picks a monitor by", async () => {
      await show([monitor()]);

      const headings = [...container.querySelectorAll("thead th")].map((cell) =>
        cell.textContent?.trim(),
      );

      expect(headings).toEqual(["Monitor", "Status", "Next run", "Last poll", "Found", "Actions"]);
    });

    it("opens the monitor's own page from its name", async () => {
      await show([monitor()]);

      const link = container.querySelector(".monitor-table-name");

      expect(link?.getAttribute("href")).toBe(`/projects/${projectId}/monitors/${monitorId}`);
      expect(link?.textContent).toBe("Teams replacing manual QA");
    });

    /**
     * US-109. Four figures on this row are about the work — posts returned,
     * posts skipped, money spent, polls made — and none of them says whether a
     * lead came out. This is the one that does.
     */
    it("says how many matches came out, and how many nobody has opened", async () => {
      await show([monitor({ matches: { total: 20, unread: 3 } })]);

      const found = container.querySelector(".monitor-table-found");

      expect(found?.textContent).toContain("20");
      expect(found?.textContent).toContain("3 unread");
    });

    /**
     * A browser holds a build for as long as its tab is open. A row from an
     * API that predates the count must not read as a monitor that found
     * nothing.
     */
    it("shows a dash rather than a zero when the server sent no count", async () => {
      const { matches: _dropped, ...older } = monitor();
      await show([older]);

      expect(container.querySelector(".monitor-table-found")?.textContent).toBe("—");
    });

    it("says when the next poll is due", async () => {
      // Hourly, and it last polled two hours ago: overdue rather than waiting.
      const due = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await show([monitor({ lastPolledAt: due })]);

      expect(rows(container)[0]?.textContent).toContain("due now");
    });

    it("says a paused monitor is not late, rather than leaving the cell empty", async () => {
      await show([monitor({ paused: true })]);

      const cells = rows(container)[0]?.querySelectorAll("td");

      expect(cells?.[1]?.textContent).toBe("Paused");
    });

    it("says a monitor that has never polled is waiting, not overdue", async () => {
      await show([monitor({ lastPolledAt: null })]);

      expect(rows(container)[0]?.textContent).toContain("Waiting for the first poll");
    });
  });

  describe("what the last poll did", () => {
    /**
     * US-104. On 2026-09-09 a monitor on the production instance had polled
     * fifteen times, spent $0.666 and stored no post, and this screen said
     * `Running`. The two readings that leaves a person — nobody is talking, or
     * this product does not work — are both wrong.
     */
    it("says a poll found nothing, and what it cost", async () => {
      await show([monitor({ lastPoll: poll() })]);

      const text = container.textContent ?? "";

      expect(text).toContain("Last poll found no posts");
      // The spend is the half that rules out a quiet platform. A quiet
      // platform costs nothing.
      expect(text).toContain("$0.5439");
    });

    it("does not let a monitor that found nothing read as Running alone", async () => {
      await show([monitor({ lastPoll: poll() })]);

      expect(container.textContent).toContain("Found nothing");
      // The label carries its own count, so the whole string is the assertion.
      expect(button("Needs attention 1")).toBeTruthy();
      // It is still active, and that count must not say otherwise.
      expect(button("Running 1")).toBeTruthy();
    });

    it("counts posts returned apart from posts new", async () => {
      /**
       * Five returned and none new is deduplication working, and it is a
       * different sentence from five returned and five new. One "posts found"
       * number is what this screen had, and it says neither.
       */
      await show([
        monitor({
          lastPoll: poll({ outcome: "collected", postsReturned: 5, postsNew: 0, units: 1 }),
        }),
      ]);

      expect(container.textContent).toContain("Last poll: 5 posts, 0 new");
      expect(container.textContent).not.toContain("Found nothing");
    });

    it("says which platform failed when the poll collected anyway", async () => {
      /**
       * BUG-016. A 503 on X used to discard Reddit's collection outright; now
       * Reddit's posts are kept, and this line is what stops the poll reading
       * as an ordinary success. The outcome is `collected` and stays that way
       * — it did collect — so the failure has to arrive in the sentence.
       */
      await show([
        monitor({
          lastPoll: poll({
            outcome: "collected",
            postsReturned: 5,
            postsNew: 5,
            stopReason: "error",
            sources: [
              { ...poll().sources[0], source: "reddit", reason: null },
              { ...poll().sources[0], source: "x", provider: "socialcrawl", reason: "error" },
            ],
          }),
        }),
      ]);

      const text = container.textContent ?? "";

      expect(text).toContain("5 posts, 5 new");
      expect(text).toContain("X failed");
    });

    it("turns a stop reason into a sentence rather than printing it", async () => {
      await show([
        monitor({ lastPoll: poll({ outcome: "refused", stopReason: "no_provider_choice" }) }),
      ]);

      expect(container.textContent).toContain("no provider is chosen");
      expect(container.textContent).not.toContain("no_provider_choice");
    });

    it("says a monitor that has never polled has never polled", async () => {
      await show([monitor({ lastPoll: null })]);

      expect(container.textContent).toContain("No poll recorded yet");
    });

    /**
     * The history is fifty polls of one monitor and this page holds one poll
     * of every monitor. Loading it here would cost a request per row for a
     * question nobody asked, which is why it lives on the monitor's own page.
     */
    it("asks for no poll history at all", async () => {
      await show([monitor({ lastPoll: poll() }), monitor({ id: "second", name: "Another" })]);

      const asked = fetchMock.mock.calls.filter(([url]) => String(url).includes("/polls"));

      expect(asked).toHaveLength(0);
    });
  });

  describe("which monitor needs a person", () => {
    it("says a monitor stopped by its cap is not merely paused", async () => {
      // The failure US-013 exists to prevent is a monitor that quietly stops
      // collecting. "Paused" alone would send a person looking for a button
      // somebody pressed; the sentence itself is on the monitor's page.
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
            reason: "Stopped at the budget.",
            since: "2026-03-01T00:00:00.000Z",
          },
        }),
      ]);

      expect(container.querySelector(".monitor-status")?.textContent).toBe("Budget spent");
    });

    it("counts a monitor whose notifications are broken among the ones needing attention", async () => {
      await show([
        monitor({ notificationIssues: ["Webhook disabled after repeated delivery failures."] }),
      ]);

      expect(button("Needs attention 1")).toBeTruthy();
      // The row says so too. A count nobody can act on from the list is a
      // number that sends a person hunting through every monitor.
      expect(container.textContent).toContain("Webhook disabled");
    });

    it("combines status and search filters and lets a person clear an empty result", async () => {
      await show([
        monitor(),
        monitor({ id: "paused", name: "Customer questions", paused: true, sources: ["youtube"] }),
        monitor({
          id: "attention",
          name: "Delivery issues",
          notificationIssues: ["Webhook disabled."],
        }),
      ]);
      await act(async () => button("Needs attention 1").click());
      expect(rows(container)).toHaveLength(1);
      expect(rows(container)[0]?.textContent).toContain("Delivery issues");
      await act(async () => setValue(field("Search monitors"), "youtube"));
      expect(rows(container)).toHaveLength(0);
      expect(container.textContent).toContain("No monitors match these filters");
      await act(async () => button("Clear filters").click());
      expect(rows(container)).toHaveLength(3);
      await act(async () => setValue(field("Search monitors"), " YOUTUBE "));
      expect(rows(container)).toHaveLength(1);
      expect(rows(container)[0]?.textContent).toContain("Customer questions");
    });
  });

  describe("the one action a person takes from a row", () => {
    it("pauses a monitor without opening it", async () => {
      await show([monitor()]);

      button("Pause").click();
      await settle();

      const [url, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];

      expect(url).toBe(`/api/monitors/${monitorId}/pause`);
      expect(init.method).toBe("POST");
    });

    it("offers Resume on a monitor somebody paused", async () => {
      await show([monitor({ paused: true })]);

      expect(button("Resume")).toBeTruthy();
    });
  });

  it("scopes the overview to the project in the address", async () => {
    await show(
      [
        monitor({ projectId: "one", projectName: "First project" }),
        monitor({ id: "other", paused: true, projectId: "two", projectName: "Second project" }),
      ],
      "one",
    );

    expect(container.textContent).toContain("1 of 1 active");
    expect(rows(container)).toHaveLength(1);
  });

  it("explains a project with no monitors, and offers the form inside it", async () => {
    await show(
      [
        monitor({ projectId: "one", projectName: "First project" }),
        monitor({ id: "other", paused: true, projectId: "two", projectName: "Second project" }),
      ],
      "empty",
    );

    expect(container.textContent).toContain("No monitors in this project yet");
    expect(container.querySelector('a[href="/projects/empty/monitors/new"]')).not.toBeNull();
  });

  it("offers to create one when there are no monitors", async () => {
    await show([]);

    expect(container.textContent).toContain("No monitors yet");
  });

  it("offers the feedback as a file, so it survives a reinstall", async () => {
    await show([monitor()]);

    const link = [...container.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Export feedback"),
    );
    expect(link?.getAttribute("href")).toBe("/api/feedback/export");
  });
});

/**
 * Grouping the list by project. US-045.
 *
 * The rule that matters is the one about monitors with no project: grouping
 * must not make a monitor harder to find than the flat list did, and every
 * monitor that existed before projects has none.
 */
describe("grouping monitors by project", () => {
  const inProject = (id: string, name: string, monitorName: string) =>
    ({ id: monitorName, projectId: id, projectName: name, name: monitorName }) as never;

  it("keeps a monitor with no project visible, in a group with no heading", () => {
    const groups = groupsOf([
      inProject("p1", "Acme QA", "reddit weekly"),
      { id: "loose", name: "an old monitor" } as never,
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.name).toBe("Acme QA");
    // Null, not "Other": a heading nobody made is a name for a thing that does
    // not exist, and it reads as a project the person forgot creating.
    expect(groups[1]?.name).toBeNull();
    expect(groups[1]?.monitors).toHaveLength(1);
  });

  it("puts the ungrouped monitors last, however they arrived", () => {
    const groups = groupsOf([
      { id: "loose", name: "an old monitor" } as never,
      inProject("p1", "Acme QA", "reddit weekly"),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Acme QA", null]);
  });

  it("gathers a project's monitors under one heading", () => {
    const groups = groupsOf([
      inProject("p1", "Acme QA", "reddit"),
      inProject("p2", "Beta", "x"),
      inProject("p1", "Acme QA", "tiktok"),
    ]);

    expect(groups.map((group) => group.monitors.length)).toEqual([2, 1]);
    // Order is the monitors' own — newest first — so a project sits where its
    // newest monitor does and a rename never reorders the page.
    expect(groups.map((group) => group.name)).toEqual(["Acme QA", "Beta"]);
  });

  it("treats an id with no name as ungrouped rather than showing a uuid", () => {
    // An older API joins nothing, so a name can be absent while an id is not.
    const groups = groupsOf([{ id: "m", name: "one", projectId: "p1" } as never]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBeNull();
  });
});
