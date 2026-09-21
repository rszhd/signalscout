---
id: US-289
title: A project's searches take turns across the hour
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

**By search.** The first cut rotated platforms, because a poll kept its
"seen up to" window (`source_coverage`) and its paging state
(`source_continuations`) per platform and re-keying both was the risk. The
owner wanted four searches on one platform to take turns too, so both
tables gain a `query` column and the unit of a turn is one search on one
platform — or a platform's channels, which are a unit of their own. A row
written before the column carries the empty query, which is the whole
platform, and that is what a monitor that does not take turns keeps
writing. A search that sits out an hour therefore picks up from its own
window and does not lose the posts written meanwhile.

**A credit balance, not a slot.** A search has weight — one credit, five
on LinkedIn — and the hour's credits rarely divide the turn evenly. So the
monitor carries a balance: each poll adds its credits an hour, runs the
next search in turn while the balance is above zero (the first may take the
balance negative, and it is repaid over the next hours), then further ones
only while the balance covers them. Over a day this spends exactly the
credits an hour, whatever the shapes. The balance is capped at one full
turn, so a monitor that was paused for a week runs one turn on resume and
not a week's.

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
- [x] Migration 0068 adds `query text not null default ''` to
      `source_coverage` (in its primary key) and `source_continuations` (in
      its unique key), journaled. Its statements were reordered by hand:
      the generator named the new key before the column it names.
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
- [x] `rotation-steps.test.ts` drives a three-platform monitor at one credit
      an hour through four polls and sees one search each, in order, and
      then the first again; four searches on one platform one at a time,
      each with its own window; a LinkedIn search at five credits against
      one an hour runs once and then waits four polls; and a poll run lists
      a platform once however many of its searches ran.
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

- 2026-09-22T02:30+08:00 — Reshaped from platforms to searches on the
  owner's word: four searches on one platform must take turns too. Both
  windows gain a `query` column (migration 0068); the collect step runs
  units. 129 files, 2,304 tests pass.

- 2026-09-22T01:40+08:00 — Built on `feature/us-289-rotation`, from `dev`
  after 0.12.0. `worker/rotation.ts` is the rule, `rotation.test.ts` its
  nine cases written first, `rotation-steps.test.ts` the collect step
  obeying it; migration 0067 adds the three columns. 129 files, 2,301 tests
  pass. Nothing has run live. The release box waits for the owner.
- 2026-09-22T01:10+08:00 — Written from the hosted product's US-285, after
  the owner chose an hourly inbox over a batch every N hours.
