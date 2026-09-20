/**
 * The words and the arithmetic both monitor screens share. US-109.
 *
 * These moved out of `Monitors.test.tsx` with the functions themselves. They
 * are asserted once, here, rather than on each screen: the list and the
 * monitor page must say the same thing about the same row, and a rule tested
 * through two screens is a rule that can be edited on one of them.
 */
import { describe, expect, it } from "vitest";
import {
  activityGroupsOf,
  anyWorking,
  formatMicros,
  type Monitor,
  monitoringState,
  pollSummary,
  type Stage,
  type StageRun,
  stageDidLabel,
  stageLabel,
  stageLine,
  toMicros,
} from "./monitor.js";
import { monitor, poll } from "./monitor-fixtures.js";

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
 * What the inbox bar and the monitor page's headline say. US-265.
 *
 * Asserted here rather than through a screen, for the reason at the top of
 * this file: the bar and the monitor screens must not end up saying two
 * different things about one monitor, and a rule tested through a screen is a
 * rule that can be edited on the other one.
 */
describe("the monitoring state", () => {
  const now = new Date("2026-03-14T08:30:00.000Z").getTime();

  /** The fixture the monitor screens use, as the type the function takes. */
  function row(overrides: Record<string, unknown> = {}): Monitor {
    return monitor(overrides) as unknown as Monitor;
  }

  function stage(overrides: Record<string, unknown> = {}): Stage {
    return {
      queue: "classify",
      state: "active",
      since: "2026-03-14T08:20:00.000Z",
      items: 12,
      ...overrides,
    } as Stage;
  }

  it("says nothing when there is no monitor", () => {
    expect(monitoringState([], now)).toBeNull();
  });

  it("names the next poll when the monitor is waiting for it", () => {
    // Hourly, polled at 08:00, and it is 08:30.
    const state = monitoringState([row({ lastPoll: poll({ outcome: "collected" }) })], now);

    expect(state?.label).toBe("Running");
    expect(state?.now).toBe("Next poll in 30 minutes");
    expect(state?.nowAt).toBe("2026-03-14T09:00:00.000Z");
    expect(state?.working).toBe(false);
  });

  it("says a poll is due when its time has passed", () => {
    const late = new Date("2026-03-14T10:00:00.000Z").getTime();

    expect(monitoringState([row()], late)?.now).toBe("Next poll due now");
  });

  it("says a poll is running now, and does not also report it as the last one", () => {
    const state = monitoringState(
      [row({ lastPoll: poll({ outcome: "waiting", postsReturned: 12, postsNew: 3 }) })],
      now,
    );

    expect(state?.now).toBe("Collecting: 12 posts so far, 3 new · $0.5439 (estimated)");
    expect(state?.last).toBeNull();
    expect(state?.working).toBe(true);
  });

  it("reports the last poll and when it started", () => {
    const state = monitoringState(
      [row({ lastPoll: poll({ outcome: "collected", postsReturned: 72, postsNew: 12 }) })],
      now,
    );

    expect(state?.last).toBe("Last poll: 72 posts, 12 new · $0.5439 (estimated)");
    expect(state?.lastAt).toBe("2026-03-14T08:00:00.000Z");
  });

  it("does not offer a next poll for a monitor that is paused", () => {
    const state = monitoringState([row({ paused: true })], now);

    expect(state?.label).toBe("Paused");
    expect(state?.now).toBe("Paused — nothing is collected until it is resumed");
    expect(state?.nowAt).toBeNull();
  });

  it("says the month is spent rather than naming a poll that will not run", () => {
    const state = monitoringState(
      [row({ spend: { ...row().spend, exhausted: true, reason: "budget_exhausted" } })],
      now,
    );

    expect(state?.label).toBe("Budget spent");
    expect(state?.now).toBe("No more polls this month");
  });

  it("waits for the first poll of a monitor that has never run", () => {
    const state = monitoringState([row({ lastPolledAt: null, lastPoll: null })], now);

    expect(state?.now).toBe("Waiting for the first poll");
    expect(state?.last).toBeNull();
  });

  it("speaks for the monitor that needs attention, not the first one", () => {
    const fine = row({ id: "fine" });
    const stuck = row({ id: "stuck", missingCredentials: [{ environmentVariable: "X" }] });

    expect(monitoringState([fine, stuck], now)?.monitor.id).toBe("stuck");
  });

  it("otherwise speaks for the monitor that polls soonest", () => {
    const later = row({ id: "later", pollIntervalSeconds: 12 * 3600 });
    const sooner = row({ id: "sooner", pollIntervalSeconds: 3600 });

    expect(monitoringState([later, sooner], now)?.monitor.id).toBe("sooner");
  });

  it("says nothing about a row an older API sent without the status fields", () => {
    expect(monitoringState([{ id: "old", name: "Old" } as unknown as Monitor], now)).toBeNull();
  });

  it("names each stage, with what it holds", () => {
    expect(stageLabel(stage({ queue: "poll", items: null }))).toBe("Collecting posts");
    expect(stageLabel(stage({ queue: "filter", items: 40 }))).toBe(
      "Filtering and triaging 40 posts",
    );
    expect(stageLabel(stage({ queue: "replies", items: 3 }))).toBe(
      "Reading comment threads under 3 posts",
    );
    expect(stageLabel(stage())).toBe("Scoring 12 posts");
    expect(stageLabel(stage({ queue: "notify", items: 1 }))).toBe("Sending 1 notification");
  });

  it("says a queued stage is queued, not running", () => {
    expect(stageLabel(stage({ state: "queued" }))).toBe("Queued to score 12 posts");
  });

  it("drops the count where the job carries none", () => {
    expect(stageLabel(stage({ queue: "filter", items: null }))).toBe(
      "Filtering and triaging posts",
    );
  });

  it("says something plain about a stage it has no words for", () => {
    // A worker newer than this bundle can run a queue this build has no
    // words for. The stage is still true; only its sentence is missing.
    expect(stageLabel(stage({ queue: "summarise" }))).toBe("Working");
    expect(stageLabel(stage({ queue: "summarise", state: "queued" }))).toBe("Queued");
  });

  it("puts the stage where the next poll would be, and keeps the last poll", () => {
    const state = monitoringState(
      [
        row({
          lastPoll: poll({ outcome: "collected", postsReturned: 72, postsNew: 12 }),
          stage: stage(),
        }),
      ],
      now,
    );

    expect(state?.now).toBe("Scoring 12 posts");
    expect(state?.nowAt).toBe("2026-03-14T08:20:00.000Z");
    expect(state?.last).toBe("Last poll: 72 posts, 12 new · $0.5439 (estimated)");
    expect(state?.working).toBe(true);
  });

  it("does not count a queued stage as work in flight", () => {
    // The bar still names it, because it is what happens next and it is about
    // to. What it must not do is make the screen ask four times a minute.
    const state = monitoringState([row({ stage: stage({ state: "queued" }) })], now);

    expect(state?.now).toBe("Queued to score 12 posts");
    expect(state?.working).toBe(false);
  });

  it("keeps the poll's own sentence while the poll itself is collecting", () => {
    // The run says more than the queue row does: how many posts it has so far.
    const state = monitoringState(
      [
        row({
          lastPoll: poll({ outcome: "waiting", postsReturned: 12, postsNew: 3 }),
          stage: stage({ queue: "poll", items: null }),
        }),
      ],
      now,
    );

    expect(state?.now).toContain("Collecting: 12 posts so far, 3 new");
  });

  it("speaks for the monitor with work in flight, over one merely due", () => {
    const due = row({ id: "due", pollIntervalSeconds: 60 });
    const busy = row({ id: "busy", pollIntervalSeconds: 12 * 3600, stage: stage() });

    expect(monitoringState([due, busy], now)?.monitor.id).toBe("busy");
    expect(anyWorking([due, busy])).toBe(true);
    expect(anyWorking([due])).toBe(false);
  });

  it("ignores a stage an older API sent as something else", () => {
    const state = monitoringState([row({ stage: { queue: 7 } })], now);

    expect(state?.now).toBe("Next poll in 30 minutes");
  });
});

/**
 * Which poll a sentence is about. US-266.
 *
 * Every row of a history said "Last poll", and only the top one could mean
 * it. The history now says "this", and the current-activity line keeps "last".
 */
describe("the subject of a poll's sentence", () => {
  it("says last by default, and this for a row in the history", () => {
    const collected = poll({ outcome: "collected", postsReturned: 72, postsNew: 12, units: 0 });
    expect(pollSummary(collected)).toBe("Last poll: 72 posts, 12 new");
    expect(pollSummary(collected, "this")).toBe("This poll: 72 posts, 12 new");

    const empty = poll({ units: 0 });
    expect(pollSummary(empty)).toBe("Last poll found no posts");
    expect(pollSummary(empty, "this")).toBe("This poll found no posts");

    const failed = poll({ outcome: "failed", units: 0 });
    expect(pollSummary(failed)).toBe("The last poll failed");
    expect(pollSummary(failed, "this")).toBe("This poll failed");

    const refused = poll({ outcome: "refused", stopReason: "budget_exhausted", units: 0 });
    expect(pollSummary(refused, "this")).toBe(
      "This poll collected nothing: the monthly budget was spent",
    );
  });
});

/**
 * What a finished stage says it did. US-266.
 *
 * Past tense throughout, against the live headline's present tense. The two
 * sit on one screen — "Scoring 12 posts" above, "Scored 12 posts" in the list
 * — and a person has to be able to tell which half is about now.
 */
describe("a stage in the history", () => {
  const classifyDetail = {
    stage: "classify" as const,
    scored: 12,
    matched: 3,
    unclassified: 0,
    dropped: 0,
    leftByCap: 0,
  };

  function run(overrides: Record<string, unknown> = {}): StageRun {
    return {
      id: "s1",
      stage: "classify",
      walkId: "walk-1",
      pollRunId: "poll-1",
      startedAt: "2026-03-14T08:20:00.000Z",
      finishedAt: "2026-03-14T08:22:00.000Z",
      outcome: "done",
      itemsIn: 12,
      itemsOut: 3,
      units: 0,
      estimatedCostMicros: 4_200,
      detail: classifyDetail,
      stopReason: null,
      ...overrides,
    } as StageRun;
  }

  it("says what the classifier scored and what matched", () => {
    expect(stageDidLabel(run())).toBe("Scored 12 posts — 3 matched");
  });

  it("says how many it actually asked about, and how many were already done", () => {
    // US-206: a retry is handed the whole batch and asks about almost none.
    const state = run({
      itemsIn: 116,
      itemsOut: 0,
      outcome: "failed",
      stopReason: "error",
      detail: {
        stage: "classify",
        scored: 0,
        skipped: 115,
        matched: 0,
        unclassified: 1,
        dropped: 0,
        leftByCap: 0,
      },
    });

    expect(stageLine(state)).toBe(
      "Scored 0 of 116 posts — 0 matched, 115 already scored, 1 left unclassified — " +
        "the job failed and will be retried",
    );
  });

  it("reads a row from before the skip was counted", () => {
    expect(stageDidLabel(run({ detail: classifyDetail }))).toBe("Scored 12 posts — 3 matched");
  });

  it("names what the classifier could not finish, and the cap that stopped it", () => {
    const state = run({
      detail: {
        stage: "classify",
        scored: 7,
        matched: 2,
        unclassified: 3,
        dropped: 1,
        leftByCap: 4,
      },
    });

    expect(stageDidLabel(state)).toBe(
      "Scored 7 posts — 2 matched, 3 left unclassified, 1 given up on, 4 not reached: the cap",
    );
  });

  it("explains the pre-filter in the words the rest of the page uses", () => {
    const state = run({
      stage: "filter",
      itemsIn: 40,
      itemsOut: 12,
      detail: { stage: "filter", keyword: 18, embedding: 7, triage: 3 },
    });

    expect(stageDidLabel(state)).toBe(
      "Filtered 40 posts — 12 kept, 18 did not use your words, 7 were not about your subject, " +
        "3 read as someone answering",
    );
  });

  it("says a pre-filter that dropped nothing dropped nothing", () => {
    const state = run({
      stage: "filter",
      itemsIn: 5,
      itemsOut: 5,
      detail: { stage: "filter", keyword: 0, embedding: 0, triage: 0 },
    });

    expect(stageDidLabel(state)).toBe("Filtered 5 posts — 5 kept");
  });

  it("counts threads, replies and pages for the replies stage", () => {
    const state = run({
      stage: "replies",
      itemsIn: 4,
      itemsOut: 128,
      detail: { stage: "replies", threadsOpened: 3, threadsSkipped: 1, pagesBought: 6 },
    });

    expect(stageDidLabel(state)).toBe("Read 3 threads — 128 replies stored, 6 pages bought");
  });

  it("says a run that opened no thread found nothing to open", () => {
    const state = run({
      stage: "replies",
      itemsIn: 2,
      itemsOut: 0,
      detail: { stage: "replies", threadsOpened: 0, threadsSkipped: 2, pagesBought: 0 },
    });

    expect(stageDidLabel(state)).toBe("Opened no thread of 2 posts: none had grown");
  });

  it("says what a failed run produced, and then that it failed", () => {
    // A classification that scored ninety posts and could not score the last
    // twenty-seven ends `failed`, because the job throws so the queue retries
    // it. "Scored nothing: it failed" over twenty-seven new matches is a lie.
    const state = run({
      outcome: "failed",
      stopReason: "error",
      itemsIn: 117,
      itemsOut: 27,
      detail: {
        stage: "classify",
        scored: 90,
        matched: 27,
        unclassified: 27,
        dropped: 0,
        leftByCap: 0,
      },
    });

    expect(stageLine(state)).toBe(
      "Scored 90 posts — 27 matched, 27 left unclassified — the job failed and will be retried",
    );
  });

  it("says a run that produced nothing produced nothing", () => {
    const state = run({ outcome: "failed", stopReason: "error", itemsOut: 0, detail: null });

    expect(stageLine(state)).toBe("Scored nothing of 12 posts: it failed");
  });

  it("says why a stage refused", () => {
    expect(
      stageDidLabel(run({ outcome: "refused", stopReason: "no_model", itemsOut: 0, detail: null })),
    ).toBe("Scored nothing of 12 posts: no model is configured");

    expect(
      stageDidLabel(
        run({ outcome: "refused", stopReason: "budget_exhausted", itemsOut: 0, detail: null }),
      ),
    ).toBe("Scored nothing of 12 posts: the monthly budget was spent");
  });

  it("falls back to the counts for a stage it has no words for", () => {
    const state = run({ stage: "summarise", detail: null, itemsIn: 4, itemsOut: 2 });

    expect(stageDidLabel(state)).toBe("summarise: 4 in, 2 out");
  });
});

/**
 * The history, grouped by the poll that caused it. US-266.
 *
 * The screen renders what this returns, so the rule is asserted here and the
 * screen only has to be shown to use it.
 */
describe("a poll in the history", () => {
  const walk = "walk-1";

  function pollEntry(at: string, id: string) {
    return { kind: "poll" as const, at, poll: { id, walkId: walk, startedAt: at } as never };
  }

  function stageEntry(at: string, id: string, pollRunId: string | null) {
    return {
      kind: "stage" as const,
      at,
      stage: { id, walkId: walk, pollRunId, startedAt: at } as never,
    };
  }

  it("keeps stages with their exact poll when one walk contains several", () => {
    const groups = activityGroupsOf([
      stageEntry("2026-03-14T08:04:00Z", "filter-2", "poll-2"),
      pollEntry("2026-03-14T08:03:00Z", "poll-2"),
      stageEntry("2026-03-14T08:02:00Z", "filter-1", "poll-1"),
      pollEntry("2026-03-14T08:01:00Z", "poll-1"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.poll?.poll.id).toBe("poll-2");
    expect(groups[0]?.stages.map((entry) => entry.stage.id)).toEqual(["filter-2"]);
    expect(groups[1]?.poll?.poll.id).toBe("poll-1");
    expect(groups[1]?.stages.map((entry) => entry.stage.id)).toEqual(["filter-1"]);
  });

  it("keeps retries with the original poll and orders them newest first", () => {
    const groups = activityGroupsOf([
      stageEntry("2026-03-14T08:04:00Z", "retry", "poll-1"),
      stageEntry("2026-03-14T08:02:00Z", "first", "poll-1"),
      pollEntry("2026-03-14T08:03:00Z", "poll-2"),
      pollEntry("2026-03-14T08:01:00Z", "poll-1"),
    ]);

    // The group sits by its newest event, so poll-1's retry at 08:04 puts it
    // above poll-2 at 08:03.
    expect(groups[0]?.poll?.poll.id).toBe("poll-1");
    expect(groups[0]?.stages.map((entry) => entry.stage.id)).toEqual(["retry", "first"]);
  });

  /** More than two, because a pair can pass a reversed sort by accident. */
  it("reads a whole poll's stages in the same direction as the list", () => {
    const groups = activityGroupsOf([
      pollEntry("2026-03-14T08:00:00Z", "poll-1"),
      stageEntry("2026-03-14T08:01:00Z", "filter", "poll-1"),
      stageEntry("2026-03-14T08:02:00Z", "classify", "poll-1"),
      stageEntry("2026-03-14T08:03:00Z", "notify", "poll-1"),
    ]);

    expect(groups[0]?.stages.map((entry) => entry.stage.id)).toEqual([
      "notify",
      "classify",
      "filter",
    ]);
  });

  it("leaves an unknown or missing poll ungrouped", () => {
    const groups = activityGroupsOf([
      stageEntry("2026-03-14T08:03:00Z", "missing", "trimmed-poll"),
      stageEntry("2026-03-14T08:02:00Z", "older", null),
      pollEntry("2026-03-14T08:01:00Z", "poll-1"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.filter((group) => group.poll === null)).toHaveLength(2);
    expect(groups.find((group) => group.poll?.poll.id === "poll-1")?.stages).toHaveLength(0);
  });
});
