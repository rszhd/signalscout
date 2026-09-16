import { describe, expect, it } from "vitest";
import { exceedsCap, type PollShape, postsPerDay, projectMonthly, totalsFor } from "./estimate.js";

/**
 * What a query would collect and what it would cost.
 *
 * docs/testing.md, *A measured constant needs a committed instrument*: this
 * arithmetic decides a number a person reads before they spend money, so every
 * expected value below is a literal somebody can check with a calculator, and
 * none of them is recomputed the way the code computes it.
 *
 * Several cases are a live run of 2026-09-05, named where they appear. That
 * run cost $0.042 and it falsified the first version of this file, which
 * projected from the posts a sample kept rather than from the records the
 * source billed. It reported a query that had just cost ten records as free.
 *
 * The price is written out here rather than imported. Reddit through Bright
 * Data is $1.50 per 1,000 records, so 1,500 micro-dollars a record.
 */
const redditPrice = 1500;

/** Reddit's shape: fifty records is the most one query collects in a poll. */
const redditHourly: PollShape = {
  // Every day, which is what every projection assumed before US-041.
  pollDays: [0, 1, 2, 3, 4, 5, 6],
  pollIntervalSeconds: 3600,
  maxUnitsPerQueryPoll: 50,
  pricePerUnitMicros: redditPrice,
};

const week = { windowDays: 7 };

/** A sample asks for ten records. Everything below is measured against that. */
const asked = 10;

describe("how often a query finds a post", () => {
  it("divides a finished sample by the window it covered", () => {
    // Fourteen posts in a week is two a day. The sample was not stopped, so
    // fourteen is the whole week and not a floor.
    expect(
      postsPerDay({ postsFound: 14, capped: false, unitsBilled: 14, unitsAsked: 20 }, week),
    ).toBe(2);
  });

  it("measures a stopped sample by the time it actually spanned", () => {
    // The live run: ten posts from r/QualityAssurance, spanning 2026-09-03
    // 13:14 to 2026-09-05 00:28. That is 35.23 hours, so about 6.8 a day.
    expect(
      postsPerDay(
        {
          postsFound: 10,
          capped: true,
          unitsBilled: 10,
          unitsAsked: asked,
          oldestPostAt: new Date("2026-09-03T13:14:07.696Z"),
          newestPostAt: new Date("2026-09-05T00:28:09.249Z"),
        },
        week,
      ),
    ).toBeCloseTo(6.81, 2);
  });

  it("holds a burst to an hour, so ten posts in one minute is not a million a day", () => {
    // Ten posts a minute apart are one thread, not fourteen thousand a day.
    expect(
      postsPerDay(
        {
          postsFound: 10,
          capped: true,
          unitsBilled: 10,
          unitsAsked: asked,
          oldestPostAt: new Date("2026-09-05T09:00:00.000Z"),
          newestPostAt: new Date("2026-09-05T09:01:00.000Z"),
        },
        week,
      ),
    ).toBe(240);
  });

  it("reads a query that found nothing as finding nothing", () => {
    // Volume, not cost. The next block is where this query stops being free.
    expect(
      postsPerDay({ postsFound: 0, capped: false, unitsBilled: 10, unitsAsked: asked }, week),
    ).toBe(0);
  });
});

describe("what a query would cost in a month", () => {
  it("charges for the records the source billed, not for the posts we kept", () => {
    /**
     * The live run of 2026-09-05. "flaky end to end tests" was billed ten
     * records and returned no posts at all: everything Bright Data found was
     * three weeks old, and the window dropped every one.
     *
     * The first version of this file called that query free. It had just cost
     * a cent and a half, and it would cost that again on every poll for ever,
     * with nothing on the screen arguing for deleting it.
     */
    const billedButEmpty = { postsFound: 0, capped: false, unitsBilled: 10, unitsAsked: asked };

    const projection = projectMonthly(billedButEmpty, redditHourly, week);

    expect(projection.postsPerDay).toBe(0);
    // Ten records a poll, 720 polls a month, at $1.50 a thousand.
    expect(projection.monthlyUnitsLow).toBe(7_200);
    expect(projection.monthlyCostMicrosLow).toBe(10_800_000);
  });

  it("gives one figure when the source had nothing more to give", () => {
    // The live run: "manual qa before every release" was billed eight records
    // of the ten it asked for. Eight is everything that query had, so a poll
    // costs eight — 5,760 records a month, which is $8.64.
    const projection = projectMonthly(
      { postsFound: 1, capped: false, unitsBilled: 8, unitsAsked: asked },
      redditHourly,
      week,
    );

    expect(projection.capped).toBe(false);
    expect(projection.monthlyUnitsLow).toBe(5_760);
    expect(projection.monthlyCostMicrosLow).toBe(8_640_000);
    // No range: the two ends are the same measurement.
    expect(projection.monthlyCostMicrosHigh).toBe(8_640_000);
  });

  it("gives a range when the sample was billed everything it asked for", () => {
    // The live run: r/QualityAssurance filled its ten. There was more behind
    // it, and a real poll asks for fifty. One sample of ten cannot say where
    // between the two the truth lies, so it does not pretend to: $10.80 at the
    // low end, $54.00 at the high one.
    const projection = projectMonthly(
      { postsFound: 10, capped: true, unitsBilled: 10, unitsAsked: asked },
      redditHourly,
      week,
    );

    expect(projection.capped).toBe(true);
    expect(projection.unitsPerPollLow).toBe(10);
    expect(projection.unitsPerPollHigh).toBe(50);
    expect(projection.monthlyCostMicrosLow).toBe(10_800_000);
    expect(projection.monthlyCostMicrosHigh).toBe(54_000_000);
  });

  it("multiplies by the polls, so frequency is the cost dial", () => {
    // The lesson of the 2026-09-05 poll run, which billed nine to eleven
    // records a minute and stored no posts. The same query costs sixty times
    // as much polled every minute as polled every hour.
    const sample = { postsFound: 1, capped: false, unitsBilled: 10, unitsAsked: asked };

    const hourly = projectMonthly(sample, redditHourly, week);
    const everyMinute = projectMonthly(sample, { ...redditHourly, pollIntervalSeconds: 60 }, week);

    expect(hourly.monthlyCostMicrosLow).toBe(10_800_000);
    expect(everyMinute.monthlyUnitsLow).toBe(432_000);
    expect(everyMinute.monthlyCostMicrosLow).toBe(648_000_000);
  });

  /**
   * BUG-005. The projection assumed every day for as long as every monitor
   * polled every day, and the moment US-041 let a person choose weekdays it
   * quoted them a month of polls they would never make.
   */
  it("charges for the days a monitor runs on, not for seven", () => {
    const sample = { postsFound: 1, capped: false, unitsBilled: 10, unitsAsked: asked };

    const everyDay = projectMonthly(sample, redditHourly, week);
    const onWeekdays = projectMonthly(sample, { ...redditHourly, pollDays: [1, 2, 3, 4, 5] }, week);

    // Five days of seven, so five sevenths of the polls and five sevenths of
    // the bill. A B2B monitor buys the weekend at full price without this.
    expect(onWeekdays.monthlyUnitsLow).toBe(Math.round((everyDay.monthlyUnitsLow * 5) / 7));
  });

  /**
   * The number in BUG-005's own title, checked rather than described. A weekly
   * monitor was quoted a month of hourly polling — 730 polls where it makes 4.
   */
  it("does not quote a weekly monitor for a month of hourly polls", () => {
    const sample = { postsFound: 1, capped: false, unitsBilled: 10, unitsAsked: asked };

    const hourly = projectMonthly(sample, redditHourly, week);
    const weekly = projectMonthly(
      sample,
      { ...redditHourly, pollIntervalSeconds: 7 * 86_400 },
      week,
    );

    // 730 polls a month against about 4: the estimate was 180 times too high,
    // in the direction that frightens somebody off a monitor costing pennies.
    expect(hourly.monthlyUnitsLow / weekly.monthlyUnitsLow).toBeGreaterThan(150);
    expect(weekly.monthlyCostMicrosLow).toBeLessThan(100_000);
  });

  it("never projects more per poll than the connector can collect", () => {
    // A sample billed for more than a poll ever asks for. The poll's own limit
    // is what bounds the bill, so the projection stops there too.
    const projection = projectMonthly(
      { postsFound: 60, capped: false, unitsBilled: 60, unitsAsked: 60 },
      redditHourly,
      week,
    );

    expect(projection.unitsPerPollLow).toBe(50);
  });

  it("gives a free source a volume and no price at all", () => {
    // The ticket is explicit: a screen must not invent a cost that does not
    // exist. Null is "this source charges nothing", not "we cannot say".
    const free = projectMonthly(
      { postsFound: 70, capped: false, unitsBilled: 8, unitsAsked: asked },
      { ...redditHourly, pricePerUnitMicros: 0 },
      week,
    );

    expect(free.postsPerDay).toBe(10);
    expect(free.monthlyUnitsLow).toBe(5_760);
    expect(free.monthlyCostMicrosLow).toBeNull();
    expect(free.monthlyCostMicrosHigh).toBeNull();
  });

  it("costs nothing for a query the source did not bill", () => {
    // A real zero, and the only one. Bright Data's trigger call bills no
    // records, so "billed nothing" is a state that happens.
    const empty = projectMonthly(
      { postsFound: 0, capped: false, unitsBilled: 0, unitsAsked: asked },
      redditHourly,
      week,
    );

    expect(empty.unitsPerPollLow).toBe(0);
    expect(empty.monthlyCostMicrosLow).toBe(0);
    expect(empty.monthlyCostMicrosHigh).toBe(0);
  });
});

describe("comparing a plan against a cap", () => {
  it("adds the plan up at both ends", () => {
    // The live run's three queries, hourly, as the screen would total them.
    // Low: $10.80 + $8.64 + $10.80. High: two of the three were billed
    // everything they asked for, so they reach $54.00 each, and only the
    // eight-record one stays where it is.
    //
    // Note which "capped" decides this. The first query kept no posts at all
    // and was still billed ten of ten, so it is capped for cost and empty for
    // volume. Reading the posts here is the mistake that cost $0.042 to find.
    const projections = [
      projectMonthly(
        { postsFound: 0, capped: false, unitsBilled: 10, unitsAsked: asked },
        redditHourly,
        week,
      ),
      projectMonthly(
        { postsFound: 1, capped: false, unitsBilled: 8, unitsAsked: asked },
        redditHourly,
        week,
      ),
      projectMonthly(
        { postsFound: 10, capped: true, unitsBilled: 10, unitsAsked: asked },
        redditHourly,
        week,
      ),
    ];

    const totals = totalsFor(projections, 10_000_000);

    expect(totals.monthlyCostMicrosLow).toBe(30_240_000);
    expect(totals.monthlyCostMicrosHigh).toBe(116_640_000);
    // $30.24 at its cheapest, against a $10.00 cap.
    expect(totals.overCap).toBe(true);
  });

  it("flags a plan that only might spend the budget", () => {
    // One stopped sample: $10.80 at the low end and $54.00 at the high one,
    // against a $20.00 cap. A warning about money is worth giving early, and
    // the range on the screen is what lets a person disagree with it.
    const totals = totalsFor(
      [
        projectMonthly(
          { postsFound: 10, capped: true, unitsBilled: 10, unitsAsked: asked },
          redditHourly,
          week,
        ),
      ],
      20_000_000,
    );

    expect(totals.monthlyCostMicrosLow).toBe(10_800_000);
    expect(totals.overCap).toBe(true);
  });

  it("does not flag a plan that fits at both ends", () => {
    const totals = totalsFor(
      [
        projectMonthly(
          { postsFound: 1, capped: false, unitsBilled: 8, unitsAsked: asked },
          redditHourly,
          week,
        ),
      ],
      20_000_000,
    );

    expect(totals.monthlyCostMicrosHigh).toBe(8_640_000);
    expect(totals.overCap).toBe(false);
  });

  it("flags a plan that lands exactly on the cap", () => {
    // US-013 calls a monitor exhausted at the cap, not past it. A plan
    // projected at exactly $8.64 against an $8.64 cap is a monitor that stops
    // collecting before the month is over, so it is flagged.
    const totals = totalsFor(
      [
        projectMonthly(
          { postsFound: 1, capped: false, unitsBilled: 8, unitsAsked: asked },
          redditHourly,
          week,
        ),
      ],
      8_640_000,
    );

    expect(totals.overCap).toBe(true);
  });

  it("flags nothing when no cap was given", () => {
    // A monitor with no cap is a decision, not an oversight. US-013 records
    // its spend and refuses nothing, and this says the same.
    const totals = totalsFor(
      [
        projectMonthly(
          { postsFound: 700, capped: true, unitsBilled: 10, unitsAsked: asked },
          redditHourly,
          week,
        ),
      ],
      null,
    );

    expect(totals.overCap).toBe(false);
    expect(totals.capMicros).toBeNull();
  });

  it("names one query as over the cap on its own", () => {
    // The whole reason a probe is run per query: "your plan is too broad" is
    // not an instruction. "This line costs $54 of your $20" is.
    expect(exceedsCap(54_000_000, 20_000_000)).toBe(true);
    expect(exceedsCap(8_640_000, 20_000_000)).toBe(false);
    expect(exceedsCap(null, 20_000_000)).toBe(false);
    expect(exceedsCap(54_000_000, null)).toBe(false);
  });

  it("adds up only the sources that charge", () => {
    // A plan across a free source and a metered one costs what the metered
    // one costs. Counting the free source as zero is right; counting it as
    // nothing at all would be the same number by accident.
    const sample = { postsFound: 1, capped: false, unitsBilled: 8, unitsAsked: asked };
    const free = projectMonthly(sample, { ...redditHourly, pricePerUnitMicros: 0 }, week);
    const metered = projectMonthly(sample, redditHourly, week);

    expect(totalsFor([free, metered], null).monthlyCostMicrosHigh).toBe(8_640_000);
    expect(totalsFor([free], null).monthlyCostMicrosHigh).toBeNull();
  });
});
