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

/**
 * Ordered from most expensive to least, so the cheap answers are not hidden
 * below the fold. A person who does not read the hints still reads the order.
 *
 * Nine choices rather than a free-text interval. Each one is a shape somebody
 * asked for, and the gaps between them are deliberate — a person who wants
 * every seven hours wants a cron field, and a cron field is a support burden
 * they get wrong silently and expensively.
 */
/**
 * How often, as its own question. US-041, rewritten by US-051.
 *
 * The nine combined choices below are kept for the monitors a person already
 * has, but the control now asks two questions rather than one. A schedule
 * answers *how often* and *which days*, and every combined choice was one pair
 * of answers: "Every hour, weekdays" is the hourly rate on a set of five.
 *
 * Separating them makes far more schedules reachable with one fewer thing to
 * read. Mondays, Wednesdays and Fridays at six-hourly is a schedule this
 * product could not express at all, and it is a third of the cost of the same
 * rate every day.
 */
export interface PollRate {
  readonly seconds: number;
  readonly label: string;
}

/**
 * Where a new monitor starts: hourly, every day.
 *
 * The most expensive answer, deliberately. A monitor that finds nothing on its
 * first day looks broken, and a person who wants it cheaper is shown the count
 * under the control the moment they touch it — where the old list buried the
 * same number inside an option label.
 */
export const defaultRate = hour;

export const pollRates: readonly PollRate[] = [
  { seconds: hour, label: "Every hour" },
  { seconds: 3 * hour, label: "Every 3 hours" },
  { seconds: 6 * hour, label: "Every 6 hours" },
  { seconds: 12 * hour, label: "Every 12 hours" },
  { seconds: day, label: "Once a day" },
  { seconds: 7 * day, label: "Once a week" },
];

/** The day sets that have a name. The set is the truth; a rule is a shortcut. */
export const dayRules = [
  { key: "every", label: "Every day", days: everyDay },
  { key: "weekdays", label: "Weekdays", days: weekdays },
  { key: "weekends", label: "Weekends", days: weekends },
] as const;

export type DayRuleKey = (typeof dayRules)[number]["key"] | "chosen";

/** Sunday first, matching Postgres numbering, so the chips read left to right. */
export const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const dayInitials = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Which rule a set of days adds up to, read back off the set itself.
 *
 * The set is what the scheduler reads, so the rule is derived rather than
 * stored: unticking one day of "Weekdays" moves the answer to "Chosen days"
 * without anything having to remember that it did.
 */
export function dayRuleOf(days: readonly number[]): DayRuleKey {
  const set = [...days].sort((a, b) => a - b).join();

  for (const rule of dayRules) if (rule.days.join() === set) return rule.key;

  return "chosen";
}

/** The days as a phrase, or empty when it is every day and says nothing. */
export function daysPhrase(days: readonly number[]): string {
  const rule = dayRuleOf(days);

  if (rule === "every") return "";
  if (rule === "weekdays") return "on weekdays";
  if (rule === "weekends") return "at weekends";

  const named = [...days].sort((a, b) => a - b).map((index) => dayNames[index]?.slice(0, 3) ?? "");

  if (named.length === 1) return `on ${named[0]}s`;

  return `on ${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/**
 * The whole schedule as one sentence, under the controls that made it.
 *
 * **The count is the point, not the prose.** Poll frequency is the largest
 * cost dial in this product — the same query is $10.80 a month polled hourly
 * and $648 polled every minute — and the old control buried that number inside
 * an option label, where it was read once and never compared. Here it sits
 * under both controls and moves as either is touched.
 */
export function summarise(pollIntervalSeconds: number, days: readonly number[]): string {
  const rate = pollRates.find((one) => one.seconds === pollIntervalSeconds);
  const how = (rate?.label ?? describeSchedule(pollIntervalSeconds, everyDay)).toLowerCase();
  const phrase = daysPhrase(days);
  const when = phrase ? `${how} ${phrase}` : how;

  return `Polls ${when} — about ${pollsPerMonth(pollIntervalSeconds, days)} polls a month.`;
}

export function describeSchedule(pollIntervalSeconds: number, pollDays: readonly number[]): string {
  const rate = pollRates.find((one) => one.seconds === pollIntervalSeconds);
  const phrase = daysPhrase(pollDays);

  if (rate) return phrase ? `${rate.label}, ${phrase.replace(/^(on|at) /, "")}` : rate.label;

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
