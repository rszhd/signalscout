// @vitest-environment jsdom
/**
 * One monitor's page, driven through the DOM a person uses. US-109.
 *
 * Everything here was inside a card on the list until US-109, and the cases
 * moved with it unchanged wherever the behaviour did not change. US-013 asks
 * for two of them: that a poll refused by the budget says so with its reason,
 * and that the spend and what is left of the cap sit next to the monitor they
 * belong to. The rule itself belongs to `packages/pipeline`; what this owns is
 * whether a person can see it and act on it.
 */

import { idleRefreshMs, workingRefreshMs } from "@signalscout/ui";
import {
  button,
  field,
  json,
  monitor,
  testMonitorId as monitorId,
  mount,
  poll,
  testProjectId as projectId,
  type Screen,
  select,
  settle,
  setValue,
} from "@signalscout/ui/testing";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inputVerdict, MonitorDetail, staleAfterDays } from "./MonitorDetail.js";

describe("one monitor's page", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  /**
   * One page of the history, as the API sends it. US-266. A plain list of
   * polls is the common case, so a case may hand in polls and get a page.
   */
  function activityPage(
    entries: unknown[],
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      entries: entries.map((entry) =>
        typeof entry === "object" && entry !== null && "kind" in entry
          ? entry
          : { kind: "poll", at: (entry as { startedAt: string }).startedAt, poll: entry },
      ),
      stagesRecordedSince: null,
      more: false,
      ...overrides,
    };
  }

  /** What the two statistics routes answer unless a case says otherwise. US-267. */
  let queriesAnswer: Record<string, unknown> = { floor: 30, inputs: [] };
  let leadsAnswer: Record<string, unknown> = {
    floor: 30,
    platforms: [],
    channels: [],
    kinds: [],
    intents: [],
  };

  /** The page, with this monitor and the history it has recorded. */
  async function show(
    row: unknown,
    history: unknown[] = [],
    pageOverrides: Record<string, unknown> = {},
  ) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url.includes("/activity")) return json(activityPage(history, pageOverrides));
      if (url.includes("/queries")) return json(queriesAnswer);
      if (url.includes("/leads")) return json(leadsAnswer);
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
    queriesAnswer = { floor: 30, inputs: [] };
    leadsAnswer = { floor: 30, platforms: [], channels: [], kinds: [], intents: [] };
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

  it("links to the form that edits what the monitor looks for", async () => {
    await show(monitor());

    const edit = [...container.querySelectorAll("a")].find(
      (link) => link.textContent === "Edit monitor",
    );
    expect(edit?.getAttribute("href")).toBe(`/projects/${projectId}/monitors/${monitor().id}/edit`);
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

    /**
     * The headline is what is happening, never what happened. US-265. A
     * monitor waiting for its next poll is waiting, which is what the inbox
     * bar says about the same monitor at the same moment.
     */
    it("leads with the wait, and keeps the last poll on the supporting line", async () => {
      const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await show(monitor({ lastPolledAt: halfHourAgo, lastPoll: poll() }));

      const headline = container.querySelector("#monitor-activity-title");
      expect(headline?.textContent).toBe("Next poll in 30 minutes");
      expect(container.querySelector(".monitor-activity-last")?.textContent).toContain(
        "Last poll found no posts",
      );
    });

    it("leads with the stage in flight", async () => {
      await show(
        monitor({
          lastPoll: poll(),
          stage: { queue: "filter", state: "active", since: new Date().toISOString(), items: 40 },
        }),
      );

      expect(container.querySelector("#monitor-activity-title")?.textContent).toBe(
        "Filtering and triaging 40 posts",
      );
    });

    describe("how often the page asks again", () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      function reads(): number {
        return fetchMock.mock.calls.filter(([url]) => String(url) === `/api/monitors/${monitorId}`)
          .length;
      }

      async function tick(ms: number): Promise<void> {
        await act(async () => {
          vi.advanceTimersByTime(ms);
        });
        await settle();
      }

      it("asks every fifteen seconds while a stage runs", async () => {
        await show(
          monitor({
            stage: {
              queue: "classify",
              state: "active",
              since: new Date().toISOString(),
              items: 3,
            },
          }),
        );
        const before = reads();

        await tick(workingRefreshMs);
        expect(reads()).toBe(before + 1);
      });

      it("asks once a minute while waiting", async () => {
        await show(monitor());
        const before = reads();

        await tick(workingRefreshMs);
        expect(reads()).toBe(before);

        await tick(idleRefreshMs - workingRefreshMs);
        expect(reads()).toBe(before + 1);
      });
    });

    it("says a monitor that has never polled is waiting for its first poll", async () => {
      // US-265: the headline is what is happening now, in the inbox bar's own
      // words, so the two screens cannot disagree about one monitor.
      await show(monitor({ lastPolledAt: null, lastPoll: null }));

      expect(container.textContent).toContain("Waiting for the first poll");
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
    it("loads the history without anybody opening a section", async () => {
      await show(monitor({ lastPoll: poll() }), [
        poll({ id: "older", outcome: "collected", postsReturned: 12, postsNew: 4, units: 2 }),
      ]);

      const asked = fetchMock.mock.calls.filter(([url]) => String(url).includes("/activity"));

      expect(button("Recent activity").getAttribute("aria-selected")).toBe("true");
      expect(button("Overview").getAttribute("aria-selected")).toBe("false");
      expect(asked).toHaveLength(1);
      expect(String(asked[0]?.[0])).toContain(`/api/monitors/${monitorId}/activity`);
      expect(container.querySelector(".poll-history")?.textContent).toContain("12 posts, 4 new");
    });

    it("says nothing has run rather than showing an empty list", async () => {
      await show(monitor(), []);

      expect(container.textContent).toContain("Nothing has run yet.");
    });

    /**
     * The history as one list. US-266.
     *
     * The sentences are pinned in `monitor.test.ts`; what this owns is that
     * the page shows the stages under their poll, calls a row "this poll" and
     * only the headline "last", pages past the first forty, and says where
     * the stage record ends.
     */
    describe("every stage, under its poll", () => {
      const at = "2026-03-14T08:05:00.000Z";
      const stage = (overrides: Record<string, unknown> = {}) => ({
        kind: "stage",
        at,
        stage: {
          id: "stage-1",
          stage: "classify",
          walkId: "walk-1",
          pollRunId: "poll-1",
          startedAt: at,
          finishedAt: at,
          outcome: "done",
          itemsIn: 12,
          itemsOut: 3,
          units: 12,
          estimatedCostMicros: 3000,
          detail: {
            stage: "classify",
            scored: 12,
            matched: 3,
            unclassified: 0,
            dropped: 0,
            leftByCap: 0,
          },
          stopReason: null,
          ...overrides,
        },
      });

      it("shows a stage under the poll it came from, newest first", async () => {
        await show(monitor({ lastPoll: poll() }), [
          stage(),
          stage({
            id: "stage-0",
            stage: "filter",
            startedAt: "2026-03-14T08:02:00.000Z",
            detail: null,
            itemsIn: 72,
            itemsOut: 12,
            outcome: "done",
          }),
          poll({ outcome: "collected", postsReturned: 72, postsNew: 12 }),
        ]);

        const group = container.querySelector(".activity-collection");
        const lines = [...(group?.querySelectorAll(".poll-history-what") ?? [])].map(
          (line) => line.textContent,
        );

        expect(lines[0]).toContain("This poll: 72 posts, 12 new");
        expect(lines[1]).toBe("Scored 12 posts — 3 matched");
        expect(group?.querySelector('[aria-label="Processing after this poll"]')).not.toBeNull();
      });

      it("calls a row this poll, and only the headline the last", async () => {
        const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        await show(monitor({ lastPolledAt: halfHourAgo, lastPoll: poll() }), [poll()]);

        expect(container.querySelector(".monitor-activity-last")?.textContent).toContain(
          "Last poll found no posts",
        );
        expect(container.querySelector(".poll-history")?.textContent).toContain(
          "This poll found no posts",
        );
        expect(container.querySelector(".poll-history")?.textContent).not.toContain("Last poll");
      });

      it("leaves notification deliveries out of the collection work", async () => {
        await show(monitor(), [
          stage({ stage: "notify", detail: { stage: "notify", deliveries: 1 } }),
        ]);

        expect(container.textContent).toContain("Nothing has run yet.");
      });

      it("asks for the next page before the oldest entry it holds", async () => {
        const first = poll({ id: "p-first", startedAt: "2026-03-14T08:00:00.000Z" });
        await show(monitor(), [first], { more: true });

        await act(async () => button("Show older").click());
        await settle();

        const asked = fetchMock.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.includes("/activity"));
        expect(asked[1]).toContain(`before=${encodeURIComponent("2026-03-14T08:00:00.000Z")}`);
      });

      it("says where the stage record ends when the polls go further back", async () => {
        await show(
          monitor(),
          [
            poll({ id: "recent", startedAt: "2026-03-14T08:00:00.000Z" }),
            poll({ id: "ancient", startedAt: "2026-03-01T08:00:00.000Z" }),
          ],
          { stagesRecordedSince: "2026-03-10T00:00:00.000Z" },
        );

        expect(container.querySelector(".activity-record-end")?.textContent).toContain(
          "those records are gone",
        );
      });

      it("says nothing about the record's end while every poll has its stages", async () => {
        await show(monitor(), [poll({ startedAt: "2026-03-14T08:00:00.000Z" })], {
          stagesRecordedSince: "2026-03-10T00:00:00.000Z",
        });

        expect(container.querySelector(".activity-record-end")).toBeNull();
      });
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
            dropped: { keyword: 340, embedding: 62, triage: 8, ceiling: 0 },
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
            dropped: { keyword: 12, embedding: 0, triage: 0, ceiling: 0 },
            read: 3,
          },
        }),
      );

      expect(container.textContent).toContain("The AI read 3 of 15 posts found");
      expect(container.textContent).toContain("12 did not use your words");
      expect(container.textContent).not.toContain("0 were not about your subject");
    });

    /**
     * The day's ceiling is not a filter stage, so it is counted with the
     * filter off as well as on. US-287.
     */
    it("counts the posts past the day's limit beside the filter's stages", async () => {
      await show(
        monitor({
          preFilter: {
            enabled: true,
            similarityThreshold: 0.15,
            dropped: { keyword: 0, embedding: 0, triage: 0, ceiling: 275 },
            read: 25,
          },
        }),
      );
      expect(container.textContent).toContain("The AI read 25 of 300 posts found");
      expect(container.textContent).toContain(
        "275 were past the day's limit for the search that found them",
      );
    });

    it("counts the posts past the day's limit with the filter off too", async () => {
      await show(
        monitor({
          preFilter: {
            enabled: false,
            similarityThreshold: 0.15,
            dropped: { keyword: 0, embedding: 0, triage: 0, ceiling: 275 },
            read: 25,
          },
        }),
      );
      expect(container.textContent).toContain("except 275 past the day's limit");
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
            dropped: { keyword: 0, embedding: 0, triage: 0, ceiling: 0 },
            read: 9,
          },
        }),
      );

      expect(container.textContent).toContain(
        "Every post this monitor collects is read by the AI, and every one is billed.",
      );
    });
  });

  describe("which score makes a match", () => {
    // US-264. `min_score` decided what every person saw and no screen showed
    // it, so an empty inbox and a floor set too high looked the same.
    it("shows the threshold beside the match count", async () => {
      await show(monitor({ matches: { total: 12, unread: 3 }, minScore: 45 }));

      expect(container.textContent).toContain("3 unread · minimum score 45");
      expect(field("Minimum score to match for Teams replacing manual QA").value).toBe("45");
    });

    it("sends the number a person typed", async () => {
      await show(monitor());

      setValue(field("Minimum score to match for Teams replacing manual QA"), "55");
      button("Save minimum score").click();
      await settle();

      const [url, init] = fetchMock.mock.calls.find(
        ([, options]) => (options as RequestInit)?.method === "PATCH",
      ) as [string, RequestInit];

      expect(url).toBe(`/api/monitors/${monitorId}`);
      expect(JSON.parse(String(init.body))).toEqual({ minScore: 55 });
    });

    it("refuses a score outside 0 to 100 without asking the server", async () => {
      await show(monitor());
      const before = fetchMock.mock.calls.length;

      setValue(field("Minimum score to match for Teams replacing manual QA"), "140");
      button("Save minimum score").click();
      await settle();

      expect(fetchMock.mock.calls).toHaveLength(before);
      expect(container.textContent).toContain("whole number from 0 to 100");
    });
  });

  /**
   * Which queries and sources earn their keep. US-267.
   *
   * The floor is named on every heading and beside the match count, so the
   * three numbers a person reads can be reconciled with each other.
   */
  describe("which queries and sources earn their keep", () => {
    const monitorWithPlan = () =>
      monitor({
        minScore: 60,
        matches: { total: 2, unread: 1 },
        queries: { reddit: ["flaky end to end tests", "manual qa before every release"] },
        subreddits: ["SaaS"],
      });

    it("names the floor beside the match count and on both headings", async () => {
      queriesAnswer = { floor: 60, inputs: [] };
      leadsAnswer = {
        floor: 60,
        platforms: [
          {
            value: "reddit",
            label: "reddit",
            source: null,
            matches: 2,
            averageScore: 90,
            bestScore: 91,
            strong: 2,
          },
        ],
        channels: [],
        kinds: [],
        intents: [],
      };
      await show(monitorWithPlan());

      expect(container.querySelector(".monitor-found")?.textContent).toContain(
        "2 matches found, 1 unread · at 60 or above",
      );
      const notes = [...container.querySelectorAll(".monitor-section-note")].map(
        (note) => note.textContent,
      );
      expect(notes.filter((note) => note === "Matches at 60 or above")).toHaveLength(2);
    });

    it("lists every input in the plan, and marks the ones to remove", async () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
      queriesAnswer = {
        floor: 60,
        inputs: [
          {
            kind: "query",
            value: "flaky end to end tests",
            posts: 40,
            matches: 3,
            bestScore: 91,
            lastFoundAt: new Date().toISOString(),
            lastMatchedAt: fortyDaysAgo,
          },
          {
            kind: "channel",
            value: "SaaS",
            posts: 12,
            matches: 0,
            bestScore: null,
            lastFoundAt: new Date().toISOString(),
            lastMatchedAt: null,
          },
        ],
      };
      await show(monitorWithPlan());

      const rows = [...container.querySelectorAll(".query-performance tbody tr")].map(
        (row) => row.textContent ?? "",
      );
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("flaky end to end tests");
      expect(rows[0]).toContain("No match in 30 days");
      expect(rows[1]).toContain("manual qa before every release");
      expect(rows[1]).toContain("Nothing found yet");
      expect(rows[2]).toContain("r/SaaS");
      expect(rows[2]).toContain("Never matched");
    });

    it("compares the sources one dimension at a time", async () => {
      leadsAnswer = {
        floor: 30,
        platforms: [
          {
            value: "reddit",
            label: "reddit",
            source: null,
            matches: 5,
            averageScore: 48,
            bestScore: 80,
            strong: 1,
          },
          {
            value: "tiktok",
            label: "tiktok",
            source: null,
            matches: 2,
            averageScore: 61,
            bestScore: 77,
            strong: 1,
          },
        ],
        channels: [],
        kinds: [
          {
            value: "post",
            label: "post",
            source: null,
            matches: 6,
            averageScore: 48,
            bestScore: 80,
            strong: 1,
          },
          {
            value: "reply",
            label: "reply",
            source: null,
            matches: 1,
            averageScore: 64,
            bestScore: 64,
            strong: 0,
          },
        ],
        intents: [
          {
            value: "problem",
            label: "Describing the problem",
            source: null,
            matches: 7,
            averageScore: 50,
            bestScore: 80,
            strong: 2,
          },
        ],
      };
      await show(monitor());

      const table = () => container.querySelector(".lead-sources tbody")?.textContent ?? "";
      expect(table()).toContain("Reddit");
      expect(table()).toContain("48 / 100");

      await act(async () => button("Posts vs. comments").click());
      expect(table()).toContain("Replies and comments");

      await act(async () => button("Intent").click());
      expect(table()).toContain("Describing the problem");
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

describe("whether a search input earns its keep", () => {
  const now = Date.parse("2026-09-20T00:00:00.000Z");
  const day = 86_400_000;
  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      kind: "query",
      value: "x",
      posts: 10,
      matches: 2,
      bestScore: 80,
      lastFoundAt: new Date(now).toISOString(),
      lastMatchedAt: new Date(now - 5 * day).toISOString(),
      ...overrides,
    }) as Parameters<typeof inputVerdict>[0];

  it("says nothing about an input that is working, or one with no row yet", () => {
    expect(inputVerdict(row(), now)).toBeNull();
    expect(inputVerdict(undefined, now)).toBeNull();
    expect(inputVerdict(row({ posts: 0, matches: 0, lastMatchedAt: null }), now)).toBeNull();
  });

  it("marks a phrase that finds posts and never a match", () => {
    expect(inputVerdict(row({ matches: 0, bestScore: null, lastMatchedAt: null }), now)).toBe(
      "Never matched",
    );
  });

  it("marks a phrase whose last match is older than thirty days", () => {
    const stale = row({ lastMatchedAt: new Date(now - (staleAfterDays + 1) * day).toISOString() });
    const fresh = row({ lastMatchedAt: new Date(now - (staleAfterDays - 1) * day).toISOString() });

    expect(inputVerdict(stale, now)).toBe("No match in 30 days");
    expect(inputVerdict(fresh, now)).toBeNull();
  });
});
