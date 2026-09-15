/**
 * What the plan sells, and what a write past it is refused with. US-133 and
 * US-134.
 *
 * Correctness-critical: plan. Nothing here reaches a database, a provider or a
 * model — the rules are pure and this is where each is pinned. Where they are
 * *called* is asserted beside each caller: `monitors.test.ts` for the write,
 * `schedule.test.ts` for the tick, `collect.test.ts` for the poll.
 */
import { describe, expect, it } from "vitest";
import {
  capacitiesFrom,
  capacityRefusal,
  defaultPlanCapacity,
  defaultTrialCapacity,
  describeInterval,
  type MonitorShape,
  type PlanCapacity,
  planCapacityFrom,
  platformDue,
  pollFloorFor,
  queriesWithin,
} from "./capacity.js";

const hour = 60 * 60;

function monitor(overrides: Partial<MonitorShape> = {}): MonitorShape {
  return {
    sources: ["reddit"],
    queries: { reddit: ["flaky tests"] },
    pollIntervalSeconds: 4 * hour,
    includeReplies: false,
    ...overrides,
  };
}

const nothingHeld = { otherMonitors: [], otherProjects: 0 };

describe("the numbers US-134 priced the plan on", () => {
  it("sells one project, one monitor, six queries and three of them on LinkedIn", () => {
    expect(defaultPlanCapacity.projects).toBe(1);
    expect(defaultPlanCapacity.monitors).toBe(1);
    expect(defaultPlanCapacity.queries).toBe(6);
    expect(defaultPlanCapacity.queriesPerPlatform.linkedin).toBe(3);
  });

  /**
   * The intervals are what pays for the platforms. Three LinkedIn queries at
   * the four-hourly rate were $27 of a $35 plan; polled daily they are $4.50.
   */
  it("polls LinkedIn daily, Instagram twice a day and the other four every four hours", () => {
    expect(defaultPlanCapacity.pollIntervalSeconds).toEqual({
      reddit: 4 * hour,
      x: 4 * hour,
      youtube: 4 * hour,
      tiktok: 4 * hour,
      instagram: 12 * hour,
      linkedin: 24 * hour,
    });
  });

  it("includes every platform, and reads no comment threads", () => {
    expect([...defaultPlanCapacity.platforms].sort()).toEqual([
      "instagram",
      "linkedin",
      "reddit",
      "tiktok",
      "x",
      "youtube",
    ]);
    expect(defaultPlanCapacity.replies).toBe(false);
  });

  /**
   * The trial is smaller than the plan, and the two platforms it drops are
   * the two that could make seven free days cost more than the first month
   * earns.
   */
  it("gives the trial four queries, daily, on neither Instagram nor LinkedIn", () => {
    expect(defaultTrialCapacity.queries).toBe(4);
    expect([...defaultTrialCapacity.platforms].sort()).toEqual([
      "reddit",
      "tiktok",
      "x",
      "youtube",
    ]);
    for (const seconds of Object.values(defaultTrialCapacity.pollIntervalSeconds)) {
      expect(seconds).toBe(24 * hour);
    }
  });
});

describe("reading a capacity from the environment", () => {
  it("is the defaults where nothing is set", () => {
    expect(planCapacityFrom({})).toEqual(defaultPlanCapacity);
    expect(capacitiesFrom({})).toEqual({
      plan: defaultPlanCapacity,
      trial: defaultTrialCapacity,
    });
  });

  it("reads each number, the platform list and one platform's interval", () => {
    const read = planCapacityFrom({
      KEYS_INCLUDED_MONITORS: "3",
      KEYS_INCLUDED_QUERIES: "12",
      KEYS_INCLUDED_QUERIES_LINKEDIN: "5",
      KEYS_INCLUDED_PLATFORMS: "reddit, x",
      KEYS_INCLUDED_POLL_SECONDS_REDDIT: "3600",
    });

    expect(read.monitors).toBe(3);
    expect(read.queries).toBe(12);
    expect(read.queriesPerPlatform.linkedin).toBe(5);
    expect(read.platforms).toEqual(["reddit", "x"]);
    expect(read.pollIntervalSeconds.reddit).toBe(3600);
    // Untouched platforms keep the default, so one variable changes one thing.
    expect(read.pollIntervalSeconds.linkedin).toBe(24 * hour);
  });

  it("reads the trial's own prefix, leaving the plan's alone", () => {
    const { plan, trial } = capacitiesFrom({
      KEYS_INCLUDED_QUERIES: "9",
      KEYS_INCLUDED_TRIAL_QUERIES: "2",
    });

    expect(plan.queries).toBe(9);
    expect(trial.queries).toBe(2);
  });

  /**
   * A typo that read as the default would sell a capacity nobody chose, which
   * is the same direction `accountCapFrom` refuses in.
   */
  it("refuses a value that is not a whole number, rather than reading the default", () => {
    expect(() => planCapacityFrom({ KEYS_INCLUDED_QUERIES: "six" })).toThrow(
      /KEYS_INCLUDED_QUERIES=six/,
    );
    expect(() => planCapacityFrom({ KEYS_INCLUDED_MONITORS: "1.5" })).toThrow();
    expect(() => planCapacityFrom({ KEYS_INCLUDED_MONITORS: "-1" })).toThrow();
  });
});

describe("what a write past the capacity is refused with", () => {
  it("allows a monitor inside the plan", () => {
    expect(capacityRefusal(defaultPlanCapacity, monitor(), nothingHeld)).toBeNull();
  });

  it("refuses a second monitor, naming the number the plan includes", () => {
    const refusal = capacityRefusal(defaultPlanCapacity, monitor(), {
      otherMonitors: [monitor()],
      otherProjects: 0,
    });

    expect(refusal).toMatch(/includes 1 monitor/);
    expect(refusal).toMatch(/already has 1/);
  });

  it("refuses a platform the plan does not include, and lists the ones it does", () => {
    const refusal = capacityRefusal(
      defaultTrialCapacity,
      monitor({ sources: ["linkedin"], queries: { linkedin: ["a"] } }),
      nothingHeld,
    );

    expect(refusal).toMatch(/does not include linkedin/);
    expect(refusal).toMatch(/reddit/);
    // The trial's refusal says so, or a platform the trial leaves out reads
    // as one the plan leaves out.
    expect(refusal).toMatch(/^Your trial /);
    expect(
      capacityRefusal(defaultPlanCapacity, monitor(), {
        otherMonitors: [monitor()],
        otherProjects: 0,
      }),
    ).toMatch(/^Your plan /);
  });

  /**
   * The count is across the account and not the monitor: six queries pointed
   * at the dearest platform is the case a per-monitor count misses.
   */
  it("counts queries across every monitor the account holds", () => {
    // A deployment selling two monitors, so the count being proved here is
    // the query count and not the monitor count above it.
    const twoMonitors: PlanCapacity = { ...defaultPlanCapacity, monitors: 2 };
    const four = monitor({ queries: { reddit: ["a", "b", "c", "d"] } });
    const three = monitor({ queries: { reddit: ["e", "f", "g"] } });

    expect(capacityRefusal(twoMonitors, four, nothingHeld)).toBeNull();

    const refusal = capacityRefusal(twoMonitors, three, {
      otherMonitors: [four],
      otherProjects: 0,
    });
    expect(refusal).toMatch(/includes 6 queries in total/);
    expect(refusal).toMatch(/would make 7/);
  });

  it("counts a platform's own limit separately, because LinkedIn is thirteen times Reddit", () => {
    const four = monitor({
      sources: ["linkedin"],
      queries: { linkedin: ["a", "b", "c", "d"] },
      pollIntervalSeconds: 24 * hour,
    });

    const refusal = capacityRefusal(defaultPlanCapacity, four, nothingHeld);

    expect(refusal).toMatch(/at most 3 queries on linkedin/);
    expect(refusal).toMatch(/would make 4/);
  });

  it("refuses an interval below the floor of the platforms named, naming the floor", () => {
    const refusal = capacityRefusal(
      defaultPlanCapacity,
      monitor({ pollIntervalSeconds: 60 }),
      nothingHeld,
    );

    expect(refusal).toMatch(/every 4 hours at most/);
  });

  it("refuses comment threads, which the plan does not carry", () => {
    const refusal = capacityRefusal(
      defaultPlanCapacity,
      monitor({ includeReplies: true }),
      nothingHeld,
    );

    expect(refusal).toMatch(/does not read comment threads/);
  });

  /** A capacity that carries replies refuses nothing about them. */
  it("allows comment threads where a deployment sells them", () => {
    const sellsReplies: PlanCapacity = { ...defaultPlanCapacity, replies: true };

    expect(
      capacityRefusal(sellsReplies, monitor({ includeReplies: true }), nothingHeld),
    ).toBeNull();
  });

  it("reads a platform's display name where one is given", () => {
    const refusal = capacityRefusal(
      defaultTrialCapacity,
      monitor({ sources: ["linkedin"], queries: { linkedin: ["a"] } }),
      nothingHeld,
      (id) => (id === "linkedin" ? "LinkedIn" : id),
    );

    expect(refusal).toMatch(/LinkedIn/);
  });
});

describe("the floor of the platforms a monitor names", () => {
  it("is the shortest of them, so each platform is then skipped on its own", () => {
    expect(pollFloorFor(defaultPlanCapacity, ["reddit", "linkedin"])).toBe(4 * hour);
    expect(pollFloorFor(defaultPlanCapacity, ["linkedin"])).toBe(24 * hour);
    expect(pollFloorFor(defaultPlanCapacity, ["instagram", "linkedin"])).toBe(12 * hour);
  });

  it("is nothing where no platform is named or none is known", () => {
    expect(pollFloorFor(defaultPlanCapacity, [])).toBeNull();
    expect(pollFloorFor(defaultPlanCapacity, ["threads"])).toBeNull();
  });
});

describe("whether a platform's turn has come round", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  it("is due when it has never been covered", () => {
    expect(platformDue(defaultPlanCapacity, "linkedin", undefined, now)).toBe(true);
  });

  it("is not due inside its own interval, and is due after it", () => {
    const elevenHoursAgo = new Date(now.getTime() - 11 * hour * 1000);
    const thirteenHoursAgo = new Date(now.getTime() - 13 * hour * 1000);

    expect(platformDue(defaultPlanCapacity, "instagram", elevenHoursAgo, now)).toBe(false);
    expect(platformDue(defaultPlanCapacity, "instagram", thirteenHoursAgo, now)).toBe(true);
    // The same moment reads differently per platform, which is the whole point.
    expect(platformDue(defaultPlanCapacity, "reddit", elevenHoursAgo, now)).toBe(true);
    expect(platformDue(defaultPlanCapacity, "linkedin", elevenHoursAgo, now)).toBe(false);
  });

  it("is due for a platform the capacity says nothing about", () => {
    expect(platformDue(defaultPlanCapacity, "threads", now, now)).toBe(true);
  });
});

describe("trimming a stored query list to what the plan carries", () => {
  it("leaves a list inside the limit alone", () => {
    const queries = ["a", "b"];
    expect(queriesWithin(defaultPlanCapacity, "reddit", queries)).toBe(queries);
  });

  it("trims to the platform's own limit, then to the total", () => {
    expect(queriesWithin(defaultPlanCapacity, "linkedin", ["a", "b", "c", "d", "e"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      queriesWithin(defaultPlanCapacity, "reddit", ["a", "b", "c", "d", "e", "f", "g", "h"]),
    ).toHaveLength(6);
  });
});

describe("the interval a sentence reads", () => {
  it("is days, hours or minutes, whichever divides", () => {
    expect(describeInterval(24 * hour)).toBe("1 day");
    expect(describeInterval(48 * hour)).toBe("2 days");
    expect(describeInterval(4 * hour)).toBe("4 hours");
    expect(describeInterval(900)).toBe("15 minutes");
    expect(describeInterval(90)).toBe("90 seconds");
  });
});
