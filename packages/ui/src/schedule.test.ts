/**
 * The schedule's words, asserted where they live. US-041, moved by US-275.
 *
 * Once, here, for both applications: the monitor page hosted and the schedule
 * control here both say "Polls every hour — about 731 polls a month", and the
 * number must come from the arithmetic the projection uses, not from a hand.
 */
import { describe, expect, it } from "vitest";
import { describeSchedule, everyDay, pollRateLabel, summarise, weekdays } from "./schedule.js";

describe("the schedule's words", () => {
  /**
   * The hints are computed from the same arithmetic the projection uses, so a
   * hint and a quote cannot disagree. BUG-005 was exactly that disagreement at
   * a larger scale, and the first draft of this list said "about 240 polls a
   * month" where the arithmetic gives 244.
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

  it("describes a schedule that matches no choice rather than rounding it", () => {
    expect(describeSchedule(6 * 3_600, everyDay)).toContain("Every 6 hours");
    expect(describeSchedule(5 * 3_600, everyDay)).toContain("5 hours");
  });

  /** The hosted product's own addition: a rate named for a plan card. */
  it("names a poll rate as the list does, and says an unlisted one in hours", () => {
    expect(pollRateLabel(6 * 3_600)).toBe("every 6 hours");
    expect(pollRateLabel(5 * 3_600)).toBe("every 5 hours");
  });
});
