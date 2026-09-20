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
  anyWorking,
  formatMicros,
  type Monitor,
  monitoringState,
  type Stage,
  stageLabel,
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
