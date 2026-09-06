---
id: US-041
title: A person chooses when a monitor runs
type: feature
priority: p1
created: 2026-09-06T12:31+08:00
parent:
area:
resolution:
---

## Context

**Nothing in the product lets a person set how often a monitor polls.** The
column exists — `monitors.poll_interval_seconds`, defaulting to an hour — and
the create route accepts it, and no screen has ever sent it. So every monitor
anybody has made runs hourly, for ever, and the only way to change that is a
`PATCH` by hand or an `UPDATE`.

**That is a money control, not a preference, and AGENTS.md already says so in
numbers.** Poll frequency is the largest cost dial this product has: the same
query costs **$10.80 a month polled hourly and $648 polled every minute**.
US-022 measured the shape of the waste directly — a monitor left at the
sixty-second floor triggered a collection every minute, and each one billed 9 to
11 records and returned no posts, because everything it found was older than the
last poll. A person who cannot reach that dial cannot fix that.

**And an interval cannot say what a person actually wants.** The owner asked
for hourly, daily, weekly, weekdays, weekends, chosen days. An integer of
seconds expresses the first three badly and the last three not at all.

The reason those matter is not tidiness. **A B2B monitor polled on Saturday
buys the weekend at full price and finds the weekend's conversation**, which is
mostly not work. Five days of seven is about 71% of the spend for close to all
of the value, and nothing in the product can express it.

**The scheduler is the honest constraint.** `worker/schedule.ts` asks one
question in SQL: is `last_polled_at + interval` in the past. That is a good rule
and it has one virtue worth keeping — two workers ticking at once agree,
because Postgres decides rather than two slightly wrong clocks. A schedule with
days and hours has to answer the same question in the same place, and "is now
inside this monitor's window" is a harder query than "has enough time passed".

Two things follow that should be decided rather than drifted into. The
timezone: a person choosing "weekdays" means their weekdays, and the database
stores UTC, so a monitor needs one or the choice is wrong for most of the world.
And what happens to a monitor whose window has closed and whose interval has
elapsed — a poll skipped is a poll skipped, not a poll owed, or a monitor
paused on holiday returns to a queue of them.

**Do not build a cron field.** A text box taking `0 */2 * * 1-5` moves the
problem to a person who will get it wrong silently and expensively. The choices
the owner listed are a small closed set, and a small closed set is what the
form should offer.

## Acceptance

- [x] The monitor form lets a person choose when a monitor runs, and the
      monitor list lets them change it afterwards
- [x] The choices cover at least: every hour, a few times a day, once a day,
      once a week — and which days, with weekdays and weekends as one press
- [x] A person picks a timezone, or the monitor takes one and the screen says
      which. "Weekdays" in UTC is wrong for most of the world
- [ ] The form says what the choice costs, because this is the largest cost
      dial in the product — **half done. Each choice carries its own polls a
      month, which is the unit that matters. The cost test still projects from
      hourly, so a monitor set to weekly is quoted a month of hourly polling.
      That is a lie by a factor of 180 and it needs its own ticket**
- [x] The floor is enforced where the worker reads it, not only in the form.
      `minimumPollIntervalSeconds` is a database constraint for the reason a
      typo of `1` instead of `100` is an invoice
- [x] The scheduler decides in Postgres, as it does today, so two workers
      ticking at once still agree about what is due
- [x] A window that was missed is not owed. A monitor that was paused, or whose
      window passed while the worker was down, polls next window rather than
      polling several times to catch up — and a test proves it
- [x] Every monitor that exists keeps polling exactly as it does now, in a
      migration that needs no answer from anybody

## Notes

- The schema change is the crux. `poll_interval_seconds` is an integer and a
  schedule is not. Adding columns beside it and keeping the interval as the
  fallback is one shape; replacing it is another. Decide, and say in the commit
  why the old column stayed or went.
- `worker/schedule.ts` is small and its comment explains why the decision is in
  SQL. Read it before proposing anything that computes due-ness in TypeScript.
- `minimumPollIntervalSeconds` is 60 and it is a check constraint, not form
  validation, because the worker reads the column directly.
- US-014's estimate multiplies by polls a month. A schedule changes that
  multiplier, so the cost test and this feature have to agree about it or the
  form will quote a month of hourly polling for a monitor that runs on Tuesdays.
- Do not let this become a scheduling engine. The owner named six shapes. Six
  shapes is a product; a cron parser is a support burden.

## Log

- 2026-09-06T12:31+08:00 — Written after the owner asked whether the UI has
  this. It does not, and the gap is larger than it looks: the column has existed
  since US-007 and no screen has ever written to it, so every monitor ever
  created polls hourly by default. p1 because it is the product's biggest cost
  dial and it is currently unreachable.

- 2026-09-06T12:56+08:00 — Built. An interval plus the days it runs on, which
  covers every shape the ticket named without a cron field.

  **Two columns, not a schedule language.** `poll_days` is a smallint array in
  Postgres's own numbering — 0 is Sunday, because the check is `extract(dow)`
  and a second numbering is a translation somebody gets wrong by one. It
  defaults to all seven, so every monitor that existed keeps polling exactly as
  it did. `poll_timezone` defaults to UTC and the form guesses the browser's.

  The choices a person sees are a closed set of six, and each one carries what
  it costs in **polls a month** — 730 for hourly, 520 for hourly on weekdays, 4
  for weekly. That unit is the point: leaving somebody to work it out is how a
  monitor ends up hourly for ever.

  **The day check went into the same query, so Postgres still decides.** A
  worker that computed the day in TypeScript would compute it in its own
  timezone, and the whole reason `now()` is Postgres's clock is that two workers
  must not disagree.

  **A missed window is not owed, and it falls out rather than being coded.** The
  query asks whether now is inside the schedule, never how many windows have
  passed — so a monitor down for thirty days is due once when it returns, and a
  test asserts exactly that.

  **The timezone is validated where it is written, not in the database.**
  `now() AT TIME ZONE` throws on a name Postgres does not know, and that call
  sits inside the scheduler's single query — one bad row would stop every
  monitor rather than its own. The API refuses a name `Intl` does not know.

  The timezone test is the one worth keeping: Kiritimati is UTC+14 and Niue is
  UTC−11, so they are never on the same weekday at the same instant. The same
  monitor, the same day, two zones — due in one and not the other.

  1,032 tests pass.

- 2026-09-06T12:56+08:00 — One box left open, and it is a real inconsistency
  rather than a missing screen. US-014's cost test multiplies by polls a month
  and still assumes hourly, so a monitor set to weekly is quoted a month of
  hourly polling — wrong by a factor of 180, in the direction that frightens
  somebody out of a cheap monitor. The form now knows the schedule and the
  estimate does not. That deserves its own ticket rather than being folded in
  here quietly.

- 2026-09-06T13:15+08:00 — Three more intervals, at the owner's request: every
  3, 6 and 12 hours. Nine choices now, and the gaps between them are still
  deliberate — somebody who wants every seven hours wants a cron field, and a
  cron field is the support burden this ticket was written to avoid.

  **The hints are computed rather than written, and that is the part worth
  keeping.** My first draft of the three new ones said 240, 120 and 60 polls a
  month where the arithmetic gives 244, 122 and 61. That is BUG-005 in
  miniature: a number on a screen disagreeing with the number the projection
  uses. So every hint now derives from the same days-per-month the core does,
  and a test pins the values so a hand-edit cannot creep back in.

