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

- [ ] The monitor form lets a person choose when a monitor runs, and the
      monitor list lets them change it afterwards
- [ ] The choices cover at least: every hour, a few times a day, once a day,
      once a week — and which days, with weekdays and weekends as one press
- [ ] A person picks a timezone, or the monitor takes one and the screen says
      which. "Weekdays" in UTC is wrong for most of the world
- [ ] The form says what the choice costs, because this is the largest cost
      dial in the product. US-014's cost test already prices a month from polls
      a month, so the number exists — the screen has to use the chosen schedule
      rather than assume hourly
- [ ] The floor is enforced where the worker reads it, not only in the form.
      `minimumPollIntervalSeconds` is a database constraint for the reason a
      typo of `1` instead of `100` is an invoice
- [ ] The scheduler decides in Postgres, as it does today, so two workers
      ticking at once still agree about what is due
- [ ] A window that was missed is not owed. A monitor that was paused, or whose
      window passed while the worker was down, polls next window rather than
      polling several times to catch up — and a test proves it
- [ ] Every monitor that exists keeps polling exactly as it does now, in a
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
