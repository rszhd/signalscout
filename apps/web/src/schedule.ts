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

const hour = 3_600;
const day = 86_400;

/**
 * Ordered from most expensive to least, so the cheap answers are not hidden
 * below the fold. A person who does not read the hints still reads the order.
 */
export const scheduleChoices: readonly ScheduleChoice[] = [
  {
    id: "hourly",
    label: "Every hour",
    hint: "about 730 polls a month — the most this will cost",
    pollIntervalSeconds: hour,
    pollDays: everyDay,
  },
  {
    id: "hourly-weekdays",
    label: "Every hour, weekdays",
    hint: "about 520 polls a month, and it skips the weekend",
    pollIntervalSeconds: hour,
    pollDays: weekdays,
  },
  {
    id: "four-hourly",
    label: "Every four hours",
    hint: "about 180 polls a month",
    pollIntervalSeconds: 4 * hour,
    pollDays: everyDay,
  },
  {
    id: "daily",
    label: "Once a day",
    hint: "about 30 polls a month",
    pollIntervalSeconds: day,
    pollDays: everyDay,
  },
  {
    id: "daily-weekdays",
    label: "Once a day, weekdays",
    hint: "about 22 polls a month",
    pollIntervalSeconds: day,
    pollDays: weekdays,
  },
  {
    id: "weekly",
    label: "Once a week",
    hint: "about 4 polls a month — the least this will cost",
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
