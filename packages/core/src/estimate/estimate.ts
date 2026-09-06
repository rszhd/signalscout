/**
 * What a search plan would collect, and what it would cost, before it runs.
 *
 * US-014. On a metered source the money is spent at fetch time, before any
 * filter and before the model sees a word. So no later stage can save a user
 * from a query that is too broad — only a narrower query can, and nobody can
 * narrow a query they have never seen run.
 *
 * The arithmetic here was written before it, for the reason docs/testing.md
 * gives about the budget guard: this decides a number a person reads before
 * they spend money. `estimate.test.ts` holds literals a person can check with
 * a calculator.
 *
 * Three decisions shape the projection, and the first one was bought with a
 * live run.
 *
 * **The cost comes from the records the source billed, never from the posts we
 * kept.** These are different numbers, and the gap is why `unitsConsumed`
 * exists in the connector interface at all. On 2026-09-05 a live sample of
 * "flaky end to end tests" was billed ten records and returned no posts,
 * because everything it found was outside the window; an earlier version of
 * this file counted the posts and reported the query as costing nothing. A
 * query that finds nothing and is billed for it is not free — it is the worst
 * kind of expensive, because nothing on the screen argues for deleting it.
 *
 * **A sample that came back full gives a range, not a figure.** It was billed
 * everything it asked for, so the truth is somewhere between one sample and a
 * whole poll, and this cannot say where. A point estimate invented from that
 * would be a number nothing measured, which is what docs/costs.md exists to
 * refuse. The high end is what the cap is checked against, because a warning
 * about money is worth giving early.
 *
 * **Volume and cost are two answers.** How often a query finds a post says
 * whether the monitor is worth having, and it comes from the posts. What it
 * costs comes from the records. A screen that showed one number would be
 * answering only one of the two questions a person is asking.
 */
import type { Source } from "../db/schema.js";

/**
 * How far back a sample looks.
 *
 * A week, because a day is too short to separate a quiet query from a dead one
 * and a month costs more to sample than the answer is worth. It is also the
 * range Bright Data offers between those two.
 */
export const sampleWindowDays = 7;

/**
 * Posts one probe asks for.
 *
 * Every one is billed, so this is the price of the answer: ten records a query
 * is a cent and a half at Reddit's rate. Enough to measure a rate from, small
 * enough that testing a plan of eight queries costs about twelve cents.
 */
export const samplePostsPerProbe = 10;

/** Posts kept from a sample, so a person can judge quality and not only volume. */
export const samplesKept = 3;

/**
 * Characters of a sample post kept. A tenth of what `posts` stores.
 *
 * Nothing re-checks an estimate against the source, so anything it holds is
 * content that cannot be reconciled when an author removes it. The title and a
 * sentence are enough to judge a query by. STACK.md, *Honor deletions*.
 */
export const sampleExcerptLength = 200;

/**
 * Resumes in a row before a probe is abandoned.
 *
 * A person is watching this one, which is why it is not the poll's hundred and
 * twenty. Twenty resumes at the provider's own thirty-second hint is about ten
 * minutes: longer than every collection the live run saw, and short enough
 * that a stuck sample ends in an answer rather than a spinner.
 */
export const maxEstimateAttempts = 20;

/**
 * Days in the month a projection is for.
 *
 * Thirty, always, rather than the length of the month it is read in. A cost
 * test run on the 28th of February must not report a cheaper plan than the
 * same test run in March.
 */
export const daysPerMonth = 30;

/**
 * The shortest span a rate is read from.
 *
 * Ten posts a minute apart are one conversation, not fourteen thousand posts a
 * day. An hour is the floor, so a burst inside one thread cannot project a
 * number nobody would believe.
 */
export const shortestObservedSpanHours = 1;

const secondsPerDay = 86_400;
const millisecondsPerDay = 86_400_000;

/** One post from a sample, as the screen shows it. */
export interface EstimateSample {
  readonly url: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly channel: string | null;
  /** Short: see `sampleExcerptLength`. */
  readonly excerpt: string;
  readonly postedAt: string;
}

/** What one probe measured. Nothing here is a projection yet. */
export interface SampleMeasurement {
  /** Posts that survived the window the sample asked for. The volume answer. */
  readonly postsFound: number;
  /** True when the sample stopped at the size it asked for, so there was more. */
  readonly capped: boolean;
  /**
   * Billable units the source charged for this one search. The cost answer.
   *
   * Never the post count. A search that finds ten posts three weeks old is
   * billed for ten records and returns none of them.
   */
  readonly unitsBilled: number;
  /** How many the sample asked for. `unitsBilled` reaching it means there was more. */
  readonly unitsAsked: number;
  readonly oldestPostAt?: Date | null;
  readonly newestPostAt?: Date | null;
}

/** The window a sample covered. Passed in, so a test states it rather than reading it. */
export interface SampleWindow {
  readonly windowDays: number;
}

/** Everything about a source and a monitor that decides what a poll costs. */
export interface PollShape {
  readonly pollIntervalSeconds: number;
  /**
   * The days this monitor polls on. US-041, and required rather than optional.
   *
   * BUG-005 is what an optional one costs. The projection assumed every day for
   * as long as every monitor polled every day, and the moment a person could
   * choose weekdays the estimate quoted them a month of polls they would never
   * make. A default here would have hidden that again in the next caller.
   *
   * Postgres numbering, 0 is Sunday, the same as `monitors.poll_days`. Only the
   * count is used, but the days are carried whole so a projection can be
   * checked against the monitor it was made for.
   */
  readonly pollDays: readonly number[];
  readonly maxUnitsPerQueryPoll: number;
  readonly pricePerUnitMicros: number;
}

/**
 * What a month of this one query would cost, as a range.
 *
 * The two ends are equal when the sample was not stopped: the source gave
 * everything it had for that window and a poll would be billed the same. They
 * differ when it was stopped, and then the width of the range is the honest
 * measure of what one small sample cannot tell you.
 */
export interface Projection {
  /** How often this query finds a post, as a rate rather than a count. */
  readonly postsPerDay: number;
  /** True when the source billed everything the sample asked for. */
  readonly capped: boolean;
  /** Billable units one poll of this one query would consume, at each end. */
  readonly unitsPerPollLow: number;
  readonly unitsPerPollHigh: number;
  readonly monthlyUnitsLow: number;
  readonly monthlyUnitsHigh: number;
  /** Null when the source charges nothing. Zero means it charges, and this costs nothing. */
  readonly monthlyCostMicrosLow: number | null;
  readonly monthlyCostMicrosHigh: number | null;
}

/**
 * How often this query finds a post.
 *
 * A finished sample covers the whole window, so the window is the divisor. A
 * sample that stopped at its own size covers only as long as its posts span,
 * and the rate is read from that — never lower than the window would give,
 * because a stopped sample cannot mean fewer posts than a finished one.
 */
export function postsPerDay(sample: SampleMeasurement, { windowDays }: SampleWindow): number {
  if (sample.postsFound <= 0) return 0;

  const overTheWindow = sample.postsFound / windowDays;
  if (!sample.capped) return overTheWindow;

  const { oldestPostAt, newestPostAt } = sample;
  if (!oldestPostAt || !newestPostAt) return overTheWindow;

  const spanDays = (newestPostAt.getTime() - oldestPostAt.getTime()) / millisecondsPerDay;

  // Never lower than the window would give, and it cannot be: a stopped sample
  // spans at most the window it asked for.
  return sample.postsFound / Math.max(spanDays, shortestObservedSpanHours / 24);
}

/**
 * What one query would cost in a month on this monitor's schedule.
 *
 * One sample is one search, and the source said what it charged for it. That
 * charge, times the polls in a month, is the whole projection. Nothing here
 * counts posts: a query billed ten records for ten posts nobody wanted costs
 * exactly what a query billed ten records for ten good ones costs.
 *
 * The high end applies when the source billed everything the sample asked for.
 * Then it had more to give, and a real poll asks for `maxUnitsPerQueryPoll`
 * rather than the sample's ten, so the bill can be that much larger. How much
 * larger, one small sample cannot say, and this does not pretend to.
 */
export function projectMonthly(
  sample: SampleMeasurement,
  shape: PollShape,
  window: SampleWindow,
): Projection {
  const rate = postsPerDay(sample, window);

  // The source gave everything it was asked for, so there was more behind it.
  const capped = sample.unitsAsked > 0 && sample.unitsBilled >= sample.unitsAsked;

  const unitsPerPollLow = Math.min(shape.maxUnitsPerQueryPoll, sample.unitsBilled);
  const unitsPerPollHigh = capped ? shape.maxUnitsPerQueryPoll : unitsPerPollLow;

  /**
   * Polls in a month, and the day fraction is the half BUG-005 was missing.
   *
   * A monitor polling hourly on five days of seven makes five sevenths of the
   * polls, so it costs five sevenths as much. Without this a weekly monitor was
   * quoted 730 polls where it makes 4 — wrong by about 180 times, in the
   * direction that frightens somebody out of a monitor costing almost nothing.
   */
  const dayFraction = shape.pollDays.length / 7;
  const pollsPerMonth = (daysPerMonth * dayFraction * secondsPerDay) / shape.pollIntervalSeconds;
  const monthlyUnitsLow = Math.round(unitsPerPollLow * pollsPerMonth);
  const monthlyUnitsHigh = Math.round(unitsPerPollHigh * pollsPerMonth);
  const priced = (units: number) =>
    shape.pricePerUnitMicros === 0 ? null : units * shape.pricePerUnitMicros;

  return {
    postsPerDay: rate,
    capped,
    unitsPerPollLow,
    unitsPerPollHigh,
    monthlyUnitsLow,
    monthlyUnitsHigh,
    monthlyCostMicrosLow: priced(monthlyUnitsLow),
    monthlyCostMicrosHigh: priced(monthlyUnitsHigh),
  };
}

/**
 * Is this more than the cap allows?
 *
 * At the cap counts, because the guard it warns about counts it: US-013 calls
 * a monitor exhausted at `spend >= cap`, so a plan projected to land exactly
 * on the cap is a plan that stops collecting before the month ends. A flag
 * that disagreed with the guard would tell a person their plan fits and then
 * watch it be refused.
 *
 * False when either number is missing, and the two missing cases are
 * different. No cap is a decision — US-013 records a capless monitor's spend
 * and refuses nothing. No price is a free source, and a free source cannot
 * exhaust a budget.
 */
export function exceedsCap(costMicros: number | null, capMicros: number | null): boolean {
  return costMicros !== null && capMicros !== null && costMicros >= capMicros;
}

export interface EstimateTotals {
  readonly postsPerDay: number;
  readonly monthlyUnitsLow: number;
  readonly monthlyUnitsHigh: number;
  /** Null when every source in the plan charges nothing. */
  readonly monthlyCostMicrosLow: number | null;
  readonly monthlyCostMicrosHigh: number | null;
  readonly capMicros: number | null;
  /**
   * True when the plan *could* spend the budget, not only when it must.
   *
   * The high end, because this is a warning about money and the cheap mistake
   * is to give it early. A person who reads the range and disagrees can raise
   * the cap; a person who is never warned finds out from the invoice.
   */
  readonly overCap: boolean;
}

/** The plan as one line: what it finds, what it costs, and whether it fits. */
export function totalsFor(
  projections: readonly Projection[],
  capMicros: number | null,
): EstimateTotals {
  const priced = projections.filter((projection) => projection.monthlyCostMicrosHigh !== null);
  const sum = (read: (projection: Projection) => number | null) =>
    priced.length === 0
      ? null
      : priced.reduce((total, projection) => total + (read(projection) ?? 0), 0);

  const monthlyCostMicrosHigh = sum((projection) => projection.monthlyCostMicrosHigh);

  return {
    postsPerDay: projections.reduce((total, projection) => total + projection.postsPerDay, 0),
    monthlyUnitsLow: projections.reduce(
      (total, projection) => total + projection.monthlyUnitsLow,
      0,
    ),
    monthlyUnitsHigh: projections.reduce(
      (total, projection) => total + projection.monthlyUnitsHigh,
      0,
    ),
    monthlyCostMicrosLow: sum((projection) => projection.monthlyCostMicrosLow),
    monthlyCostMicrosHigh,
    capMicros,
    overCap: exceedsCap(monthlyCostMicrosHigh, capMicros),
  };
}

/** What the estimate asks a source for, per probe. `kind` says which of the two. */
export interface ProbeRequest {
  readonly source: Source;
  readonly kind: "query" | "channel";
  readonly term: string;
}

/**
 * The probes a plan needs: every query and every channel, on every source.
 *
 * One probe per term, because "your plan is too broad" is not an instruction a
 * person can act on and "this line costs $54 of your $20" is. Duplicates are
 * dropped: a plan that named one query twice would be billed twice to say the
 * same number.
 */
export function probesFor(
  sourceIds: readonly Source[],
  queries: Readonly<Record<string, readonly string[]>>,
  channels: readonly string[],
): ProbeRequest[] {
  const seen = new Set<string>();
  const probes: ProbeRequest[] = [];

  for (const source of sourceIds) {
    for (const [kind, terms] of [
      // US-027. Each platform is priced on its own queries. Pricing one shared
      // list against two platforms charged a person twice for a query only one
      // of them would ever run, and hid that the other had none.
      ["query", queries[source] ?? []],
      ["channel", channels],
    ] as const) {
      for (const raw of terms) {
        const term = raw.trim();
        if (!term) continue;

        const key = `${source} ${kind} ${term.toLowerCase()}`;
        if (seen.has(key)) continue;

        seen.add(key);
        probes.push({ source, kind, term });
      }
    }
  }

  return probes;
}
