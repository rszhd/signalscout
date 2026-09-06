import {
  dayInitials,
  dayNames,
  dayRuleOf,
  dayRules,
  everyDay,
  pollRates,
  summarise,
} from "./schedule.js";

/**
 * When a monitor runs: how often, and which days. US-041, rewritten by US-051.
 *
 * A third question is coming and is deliberately absent: US-052 adds the hours
 * of the day a monitor may poll in, because a lead found at 03:00 is eight
 * hours old by the time anybody reads it. That is a scheduler change before it
 * is a control, so the control waits for it.
 *
 * One component for the monitor form and the monitor list, so the two can
 * never offer different schedules — the same reason patrol keeps its own in
 * one file.
 *
 * **Two questions, and they are independent.** The control used to ask one:
 * nine combined choices in a dropdown, each of which was a rate and a day set
 * welded together. Splitting them makes far more schedules reachable with one
 * fewer thing to read, and it makes the cheap ones visible — "every 6 hours on
 * Mondays, Wednesdays and Fridays" could not be expressed at all before, and
 * it is three sevenths of the cost of the same rate every day.
 *
 * **The summary is the part that earns its place.** Poll frequency is the
 * largest cost dial here, and the count used to sit inside an option label
 * where it was read once and never compared. Under both controls it moves as
 * either is touched, which is what makes the difference between two answers
 * visible at the moment somebody is choosing between them.
 */
export function ScheduleField({
  pollIntervalSeconds,
  pollDays,
  timezone,
  disabled = false,
  onChange,
}: {
  pollIntervalSeconds: number;
  pollDays: readonly number[];
  timezone?: string;
  disabled?: boolean;
  onChange: (next: { pollIntervalSeconds: number; pollDays: number[] }) => void;
}) {
  const rule = dayRuleOf(pollDays);
  const known = pollRates.some((rate) => rate.seconds === pollIntervalSeconds);

  const setDays = (days: number[]) => onChange({ pollIntervalSeconds, pollDays: days });

  /**
   * The last tick cannot be cleared.
   *
   * A monitor with no days is never due, so it would sit enabled and silent —
   * and the API refuses it, which would turn a click into an error a person
   * did not ask for. Refusing it here keeps them from composing a schedule the
   * save will reject.
   */
  const only = pollDays.length === 1;

  return (
    <div className="schedule-field">
      <div className="schedule-controls">
        <label className="field">
          <span>How often</span>
          <select
            aria-label="How often"
            value={known ? String(pollIntervalSeconds) : "custom"}
            disabled={disabled}
            onChange={(event) =>
              onChange({ pollIntervalSeconds: Number(event.target.value), pollDays: [...pollDays] })
            }
          >
            {/*
              A monitor edited by hand can sit between two rates. The screen
              says what it actually does rather than rounding it to the nearest
              and changing it silently on the next save.
            */}
            {!known && <option value="custom">Every {pollIntervalSeconds} seconds</option>}
            {pollRates.map((rate) => (
              <option key={rate.seconds} value={rate.seconds}>
                {rate.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Which days</span>
          <select
            aria-label="Which days"
            value={rule}
            disabled={disabled}
            onChange={(event) => {
              const found = dayRules.find((one) => one.key === event.target.value);
              if (found) setDays([...found.days]);
            }}
          >
            {dayRules.map((one) => (
              <option key={one.key} value={one.key}>
                {one.label}
              </option>
            ))}
            {/*
              "Chosen days" names the days already ticked, so choosing it would
              do nothing — but a select with no selection over a schedule that
              is really running would read as a monitor with no days, and the
              next save would store that.
            */}
            {rule === "chosen" && <option value="chosen">Chosen days</option>}
          </select>
        </label>
      </div>

      {/* A fieldset rather than role="group": the same grouping, said in HTML. */}
      <fieldset className="day-chips">
        <legend className="visually-hidden">Days</legend>
        {dayInitials.map((initial, index) => {
          const on = pollDays.includes(index);

          return (
            <button
              // The initials repeat — two S and two T — so the name is the key.
              key={dayNames[index]}
              type="button"
              className="day-chip"
              aria-pressed={on}
              aria-label={dayNames[index]}
              disabled={disabled || (on && only)}
              onClick={() =>
                setDays(
                  on
                    ? pollDays.filter((day) => day !== index)
                    : [...pollDays, index].sort((a, b) => a - b),
                )
              }
            >
              {initial}
            </button>
          );
        })}
      </fieldset>

      <p className="schedule-summary">
        {summarise(pollIntervalSeconds, pollDays.length > 0 ? pollDays : everyDay)}
        {timezone ? ` Days are counted in ${timezone}.` : ""}
      </p>
    </div>
  );
}
