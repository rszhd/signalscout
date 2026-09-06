/**
 * The shapes a person can choose for when a monitor runs. US-041.
 *
 * A closed set, not a cron field. The owner named six shapes, and six shapes is
 * a product where a cron parser is a support burden somebody gets wrong
 * silently and expensively — poll frequency is the largest cost dial here, and
 * the difference between two of these choices is $10.80 a month against $648.
 *
 * Each choice is an interval and a set of days, because that is what the
 * scheduler reads. Nothing here is a new concept in the database.
 */

/** Postgres numbering, so 0 is Sunday. The scheduler compares against `dow`. */
export const everyDay = [0, 1, 2, 3, 4, 5, 6];
export const weekdays = [1, 2, 3, 4, 5];
export const weekends = [0, 6];

export interface ScheduleChoice {
  readonly id: string;
  readonly label: string;
  /** What it costs, said in the units a person spends: polls a month. */
  readonly hint: string;
  readonly pollIntervalSeconds: number;
  readonly pollDays: readonly number[];
}

/**
 * The same month the projection uses, so the two cannot disagree.
 *
 * `daysPerMonth` in the core is 30.44, and this screen must not carry its own
 * idea of a month — BUG-005 was a hint and a projection disagreeing, and a
 * hand-written hint is the same bug at a smaller scale. My first draft of this
 * file said "about 240 polls a month" where the arithmetic gives 244.
 */
const hour = 3_600;
const day = 86_400;

const daysPerMonth = 30.44;

function pollsPerMonth(pollIntervalSeconds: number, pollDays: readonly number[]): number {
  const dayFraction = pollDays.length / 7;

  return Math.round((daysPerMonth * dayFraction * 86_400) / pollIntervalSeconds);
}

/** The hint under a choice, computed rather than written. */
function hintFor(pollIntervalSeconds: number, pollDays: readonly number[], note = ""): string {
  return `about ${pollsPerMonth(pollIntervalSeconds, pollDays)} polls a month${note}`;
}

/**
 * Ordered from most expensive to least, so the cheap answers are not hidden
 * below the fold. A person who does not read the hints still reads the order.
 *
 * Nine choices rather than a free-text interval. Each one is a shape somebody
 * asked for, and the gaps between them are deliberate — a person who wants
 * every seven hours wants a cron field, and a cron field is a support burden
 * they get wrong silently and expensively.
 */
export const scheduleChoices: readonly ScheduleChoice[] = [
  {
    id: "hourly",
    label: "Every hour",
    hint: hintFor(hour, everyDay, " — the most this will cost"),
    pollIntervalSeconds: hour,
    pollDays: everyDay,
  },
  {
    id: "hourly-weekdays",
    label: "Every hour, weekdays",
    hint: hintFor(hour, weekdays, ", and it skips the weekend"),
    pollIntervalSeconds: hour,
    pollDays: weekdays,
  },
  {
    id: "three-hourly",
    label: "Every 3 hours",
    hint: hintFor(3 * hour, everyDay),
    pollIntervalSeconds: 3 * hour,
    pollDays: everyDay,
  },
  {
    id: "six-hourly",
    label: "Every 6 hours",
    hint: hintFor(6 * hour, everyDay),
    pollIntervalSeconds: 6 * hour,
    pollDays: everyDay,
  },
  {
    id: "twelve-hourly",
    label: "Every 12 hours",
    hint: hintFor(12 * hour, everyDay),
    pollIntervalSeconds: 12 * hour,
    pollDays: everyDay,
  },
  {
    id: "daily",
    label: "Once a day",
    hint: hintFor(day, everyDay),
    pollIntervalSeconds: day,
    pollDays: everyDay,
  },
  {
    id: "daily-weekdays",
    label: "Once a day, weekdays",
    hint: hintFor(day, weekdays),
    pollIntervalSeconds: day,
    pollDays: weekdays,
  },
  {
    id: "weekly",
    label: "Once a week",
    hint: hintFor(7 * day, everyDay, " — the least this will cost"),
    pollIntervalSeconds: 7 * day,
    pollDays: everyDay,
  },
];

/**
 * Which choice a monitor's stored settings correspond to, or none.
 *
 * A monitor edited by hand may sit between two choices, and the screen must
 * say so rather than round it to the nearest and silently change it on the
 * next save.
 */
export function choiceFor(
  pollIntervalSeconds: number,
  pollDays: readonly number[],
): ScheduleChoice | undefined {
  const days = [...pollDays].sort((left, right) => left - right).join(",");

  return scheduleChoices.find(
    (choice) =>
      choice.pollIntervalSeconds === pollIntervalSeconds &&
      [...choice.pollDays].sort((left, right) => left - right).join(",") === days,
  );
}

/** How a schedule reads when no choice matches it. */
export function describeSchedule(pollIntervalSeconds: number, pollDays: readonly number[]): string {
  const known = choiceFor(pollIntervalSeconds, pollDays);
  if (known) return known.label;

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = Math.round(pollIntervalSeconds / hour);
  const every =
    pollIntervalSeconds < hour
      ? `every ${Math.round(pollIntervalSeconds / 60)} minutes`
      : hours === 1
        ? "every hour"
        : `every ${hours} hours`;

  const days =
    pollDays.length === 7
      ? ""
      : `, on ${[...pollDays]
          .sort((left, right) => left - right)
          .map((day) => names[day] ?? "?")
          .join(", ")}`;

  return `Custom: ${every}${days}`;
}

/**
 * The timezone this browser is in, which is the right default.
 *
 * A person choosing weekdays means their weekdays. Guessing from the browser is
 * right far more often than UTC is, and the screen shows what was guessed so a
 * person can change it.
 */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
