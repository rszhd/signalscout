---
id: US-289
title: A project's platforms take turns across the hour
type: feature
priority: p2
created: 2026-09-22T01:10+08:00
parent:
area: pipeline
resolution:
---

## Context

The hosted product sells search credits a day (US-285 there), and a
project with three searches on a 24-a-day plan is polled every three
hours: every search, together, then nothing for three hours. The owner
wants the inbox to move every hour instead. Rotation does not find any
lead sooner on average — a search checked at 10:00, 13:00 and 16:00 sees
the same posts as one checked at 11:00, 14:00 and 17:00 — but a person
who opens the inbox every hour and finds something new is the point, and
it spreads load on the providers.

**By platform, not by search.** A poll keeps its "seen up to" window
(`source_coverage`) and its paging state (`source_continuations`) per
platform. Rotating single searches would need both per search, which is
the collect step's loop rewritten and two tables re-keyed; a mistake there
either re-reads posts or loses them. Rotating platforms keeps both tables
as they are: a platform runs with all its searches or not at all. With the
hosted form starting a plan at one search a platform, Starter with four
platforms gets something new every hour; only a platform that holds more
searches than the hour's credits waits a turn. Per-search rotation is the
refinement if the inbox still feels bursty, and it builds on this.

**A credit balance, not a slot.** A platform's searches have weight — one
credit each, five on LinkedIn — and the hour's credits rarely divide them
evenly. So the monitor carries a balance: each poll adds its credits an
hour, runs the next platform in turn while the balance is above zero (the
first platform may take the balance negative, and it is repaid over the
next hours), then further platforms only while the balance covers them.
Over a day this spends exactly the credits an hour, whatever the shapes.
The balance is capped at one full turn of the platforms, so a monitor
that was paused for a week runs one turn on resume and not a week's.

**Three columns on the monitor, all nullable or defaulted, and off unless
set.** `poll_credits_per_hour` null means what every monitor does today:
every platform, every poll. The application writes it beside
`poll_interval_seconds = 3600` for the projects it schedules;
`poll_credit_balance` and `poll_cursor` are the pipeline's own state. The
weights come in as a worker option, `creditWeights`, the way
`newPostsPerPairPerDay` does (US-287): the pipeline has no plans and no
prices of its own.

**What one poll does.** Reads the monitor, adds the hour's credits to the
balance, picks the platforms in order from the cursor, persists the
balance and cursor, and runs the poll as today for exactly those
platforms. A poll that picks none — the balance is still repaying a big
platform — marks `last_polled_at`, logs why at debug, and writes no poll
run: an hourly row saying "0 posts" would be a screen full of nothing.
The channels a Reddit monitor browses ride with Reddit's turn and cost no
credit, as the application counts them.

**What does not change.** The scheduler's due query (`poll_interval_seconds`
carries 3600 for a rotating monitor), the ceiling, the daily rules, the
filter, classify, replies and notify steps, and every monitor with the
column null.

## Acceptance

- [x] Migration 0067 adds `poll_credits_per_hour numeric(8,3)` (nullable),
      `poll_credit_balance numeric(8,3) not null default 0` and
      `poll_cursor integer not null default 0` to `monitors`, journaled.
- [x] `startWorker` takes `creditWeights?: Partial<Record<Source, number>>`;
      a platform not named weighs one. Unset, every platform weighs one.
- [x] One function decides a poll's platforms from the monitor's sources,
      its searches per platform, the weights, the balance and the cursor,
      and returns the platforms with the new balance and cursor. Written
      test-first: over 24 polls it spends the credits an hour exactly, the
      first platform may take the balance negative, a later one may not, the
      turn order is the monitor's source order from the cursor, and the
      balance never exceeds one full turn.
- [x] The collect step runs it when `poll_credits_per_hour` is set, persists
      the balance and cursor before asking any source, and polls those
      platforms and no others. A poll that picks none marks
      `last_polled_at`, logs at debug, and records no poll run.
- [x] A monitor with the column null polls every platform, as today;
      `collect.test.ts`'s existing cases are unchanged.
- [x] `rotation-steps.test.ts` drives a three-platform monitor at one credit an hour
      through four polls and sees one platform each, in order, and then the
      first again; and a LinkedIn platform at five credits against one an
      hour runs once and then waits four polls.
- [x] `docs/pipeline.md` says how a rotating monitor polls and that it is
      off unless an application sets the column.
- [ ] `docs/releasing.md` names the version; the application pins it and
      writes the column (US-285 there).

## Notes

- `packages/pipeline/src/worker/collect.ts` (the loop over
  `monitor.sources`), `worker/runtime.ts` (the option), `db/schema/monitors.ts`,
  `worker/rotation.ts` (new, the rule), `docs/pipeline.md`.
- The application's half: `writeAccountInterval` in `billing/limits.ts`
  there writes `poll_interval_seconds = 3600` and each running project's
  share of the plan's credits an hour; the form's sentence adds that
  platforms take turns.
- Why not per search: `source_coverage` and `source_continuations` are
  keyed by platform, and the connector is asked for a platform's searches
  in one call. Re-keying both is the larger ticket this one defers.
- Why a balance: the hour's credits and a platform's weight rarely divide.
  A slot that refused a platform heavier than the hour would never run
  LinkedIn on a one-credit plan; a slot that always ran it would overspend.

## Log

- 2026-09-22T01:40+08:00 — Built on `feature/us-289-rotation`, from `dev`
  after 0.12.0. `worker/rotation.ts` is the rule, `rotation.test.ts` its
  nine cases written first, `rotation-steps.test.ts` the collect step
  obeying it; migration 0067 adds the three columns. 129 files, 2,301 tests
  pass. Nothing has run live. The release box waits for the owner.
- 2026-09-22T01:10+08:00 — Written from the hosted product's US-285, after
  the owner chose an hourly inbox over a batch every N hours.
