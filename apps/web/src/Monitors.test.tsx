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
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMicros, groupsOf, Monitors, toMicros } from "./Monitors.js";
import { everyDay, summarise, weekdays } from "./schedule.js";
import { button, field, json, mount, type Screen, select, settle, setValue } from "./testing.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
/** The project every case is inside. A monitor list is a question about one. */
const projectId = "p1";

function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: monitorId,
    projectId,
    name: "Teams replacing manual QA",
    sources: ["reddit"],
    paused: false,
    lastPolledAt: "2026-03-14T08:00:00.000Z",
    // US-041. Hourly, every day: what every monitor did before there was a
    // control for it.
    pollIntervalSeconds: 3600,
    pollDays: [0, 1, 2, 3, 4, 5, 6],
    pollTimezone: "UTC",
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
      dropped: { keyword: 0, embedding: 0, triage: 0 },
      read: 0,
    },
    feedback: { good: 0, notRelevant: 0 },
    ...overrides,
  };
}

/**
 * What a poll did. US-104.
 *
 * The defaults are the production run of 2026-09-09, scaled to one platform: a
 * poll that asked, was billed, and returned nothing.
 */
function poll(overrides: Record<string, unknown> = {}) {
  return {
    id: "poll-1",
    walkId: "walk-1",
    startedAt: "2026-03-14T08:00:00.000Z",
    finishedAt: "2026-03-14T08:01:00.000Z",
    outcome: "empty",
    postsReturned: 0,
    postsNew: 0,
    units: 67,
    estimatedCostMicros: 543_906,
    stopReason: null,
    sources: [
      {
        source: "reddit",
        provider: "socialcrawl",
        pages: 5,
        postsReturned: 0,
        postsNew: 0,
        units: 67,
        estimatedCostMicros: 543_906,
        reason: null,
      },
    ],
    ...overrides,
  };
}

describe("the monitor list", () => {
  let screen: Screen;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function show(rows: unknown[], project = projectId) {
    fetchMock.mockImplementation(async (request: string | URL | Request) => {
      const url = typeof request === "string" ? request : request.toString();
      if (url === "/api/monitors") return json(rows);
      if (url.startsWith("/api/monitors/")) return json(rows[0]);
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

    it("asks for the polls only when the section is opened", async () => {
      /**
       * `<details>` renders its children whether it is open or not, so a
       * component that fetched on mount would fetch once per monitor the
       * moment the page loaded.
       */
      fetchMock.mockImplementation(async (request: string | URL | Request) => {
        const url = typeof request === "string" ? request : request.toString();
        if (url === "/api/monitors") return json([monitor({ lastPoll: poll() })]);
        if (url.includes("/polls")) return json([poll({ id: "older" })]);
        if (url.startsWith("/api/monitors/")) return json(monitor());
        throw new Error(`Unexpected request: ${url}`);
      });

      screen = await mount(<Monitors projectId={projectId} />, `/projects/${projectId}/monitors`);
      container = screen.container;

      const asked = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/polls"));

      expect(asked()).toHaveLength(0);

      const details = container.querySelector("details.monitor-settings");
      if (!(details instanceof HTMLDetailsElement)) throw new Error("No settings section.");

      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      });
      await settle();

      expect(asked()).toHaveLength(1);
      expect(String(asked()[0]?.[0])).toContain(`/api/monitors/${monitorId}/polls`);
    });
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
    expect(container.querySelectorAll(".monitor-card")).toHaveLength(1);
    expect(container.querySelector(".monitor-card")?.textContent).toContain("Delivery issues");
    await act(async () => setValue(field("Search monitors"), "youtube"));
    expect(container.querySelectorAll(".monitor-card")).toHaveLength(0);
    expect(container.textContent).toContain("No monitors match these filters");
    await act(async () => button("Clear filters").click());
    expect(container.querySelectorAll(".monitor-card")).toHaveLength(3);
    await act(async () => setValue(field("Search monitors"), " YOUTUBE "));
    expect(container.querySelectorAll(".monitor-card")).toHaveLength(1);
    expect(container.querySelector(".monitor-card")?.textContent).toContain("Customer questions");
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
    expect(container.querySelectorAll(".monitor-card")).toHaveLength(1);
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

  it("shows a disabled webhook and links to its settings", async () => {
    await show([
      monitor({ notificationIssues: ["Webhook disabled after repeated delivery failures."] }),
    ]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Webhook disabled");
    expect(
      container.querySelector(
        `a[href="/projects/${projectId}/monitors/${monitorId}/notifications"]`,
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

  /**
   * The counter US-008 asked for, in words a person who did not build it can
   * read. The stage's own risk is invisible everywhere else: a filter dropping
   * most of what it finds empties the inbox and looks like a quiet week.
   */
  it("says what was skipped before the AI read it, and why", async () => {
    await show([
      monitor({
        preFilter: {
          enabled: true,
          similarityThreshold: 0.15,
          dropped: { keyword: 340, embedding: 62, triage: 8 },
          read: 46,
        },
      }),
    ]);

    expect(container.textContent).toContain("The AI read 46 of 456 posts found");
    expect(container.textContent).toContain("The other 410 were skipped");
    expect(container.textContent).toContain("340 did not use your words");
    expect(container.textContent).toContain("62 were not about your subject");
    expect(container.textContent).toContain("8 read as someone answering rather than asking");
  });

  /** A stage that dropped nothing is left out rather than reported as zero. */
  it("names only the stages that skipped something", async () => {
    await show([
      monitor({
        preFilter: {
          enabled: true,
          similarityThreshold: 0.15,
          dropped: { keyword: 12, embedding: 0, triage: 0 },
          read: 3,
        },
      }),
    ]);

    expect(container.textContent).toContain("The AI read 3 of 15 posts found");
    expect(container.textContent).toContain("12 did not use your words");
    expect(container.textContent).not.toContain("0 were not about your subject");
  });

  /**
   * The threshold left the screen, and this is the case that keeps it off.
   *
   * It is a research dial: 0.15 came from one monitor and five posts, a value
   * set too high deletes leads with no row and no bill, and on every platform
   * measured the stage has dropped almost nothing. It stays editable through
   * the API, where the person changing it knows what it is.
   */
  it("asks for no similarity number", async () => {
    await show([monitor()]);

    expect(container.textContent).not.toContain("Similarity");
    expect(document.querySelector('[aria-label^="Similarity needed"]')).toBeNull();
    expect(() => button("Save threshold")).toThrow();
  });

  it("turns the pre-filter off, and says what that costs", async () => {
    await show([monitor()]);

    const everyPost = [...document.querySelectorAll<HTMLLabelElement>(".reading-option")].find(
      (option) => option.textContent?.includes("Every post found"),
    );
    everyPost?.querySelector("input")?.click();
    await settle();

    const [, init] = fetchMock.mock.calls.at(-2) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ preFilter: { enabled: false } });

    await screen.unmount();
    await show([
      monitor({
        preFilter: {
          enabled: false,
          similarityThreshold: 0.15,
          dropped: { keyword: 0, embedding: 0, triage: 0 },
          read: 9,
        },
      }),
    ]);

    expect(container.textContent).toContain(
      "Every post this monitor collects is read by the AI, and every one is billed.",
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
    const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await show([
      monitor({ lastCollected: [{ source: "reddit", provider: "scrapecreators", at }] }),
    ]);

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
      await show([monitor()]);

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
      await show([monitor()]);

      await act(async () => setValue(select("Which days"), "weekdays"));
      await settle();

      expect(patchBody()).toEqual({
        pollIntervalSeconds: 3_600,
        pollDays: [1, 2, 3, 4, 5],
      });
    });

    it("changes the rate without touching the days", async () => {
      await show([monitor({ pollIntervalSeconds: 3_600, pollDays: [1, 3, 5] })]);

      await act(async () => setValue(select("How often"), "86400"));
      await settle();

      // The two questions are independent: picking a rate must not quietly
      // reset a day set somebody chose.
      expect(patchBody()).toEqual({ pollIntervalSeconds: 86_400, pollDays: [1, 3, 5] });
    });

    /**
     * A day set no named rule covers. US-041's control could not express one at
     * all — nine welded pairs, none of them Monday, Wednesday and Friday.
     */
    it("lets a person tick the days themselves", async () => {
      await show([monitor({ pollDays: [1, 2, 3, 4, 5] })]);

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
      await show([monitor({ pollDays: [3] })]);

      const wednesday = container.querySelector<HTMLButtonElement>('[aria-label="Wednesday"]');

      expect(wednesday?.disabled).toBe(true);
    });

    /**
     * A monitor edited by hand can sit between two choices. The screen says
     * what it actually does rather than rounding it to the nearest and
     * changing it silently the next time anybody saves.
     */
    it("describes a schedule that matches no choice rather than rounding it", async () => {
      await show([monitor({ pollIntervalSeconds: 900, pollDays: [2, 4] })]);

      expect(container.textContent).toContain("Custom: every 15 minutes");
      expect(container.textContent).toContain("Tue, Thu");
    });

    it("says which timezone the days are counted in", async () => {
      await show([monitor({ pollTimezone: "Asia/Kuala_Lumpur" })]);

      expect(container.textContent).toContain("Asia/Kuala_Lumpur");
    });
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
