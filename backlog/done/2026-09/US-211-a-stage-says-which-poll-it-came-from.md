---
id: US-211
title: A stage says which poll it came from
type: feature
priority: p1
created: 2026-09-18T13:58+08:00
parent: US-203
area: pipeline
resolution: shipped
---

## Context

US-203 put the walk on every stage row, and a walk is not precise enough for
the screen it feeds. A paging collection is several polls, and the hosted
application's US-210 wants each filter and each classification shown under the
poll whose posts it processed. It cannot: three poll rows and a dozen stage
rows share one walk id, and nothing says which poll a filter was handed.

US-209 over there took the honest way out and kept the collection flat rather
than imply a relationship the data cannot prove. This makes the data prove it.

The poll's own row id is available where the hand-off happens: `finish()`
records the poll and `recordPollRun` returns the row, four lines before the
filter job is sent. So the id travels the way the walk does — in the payload,
passed from step to step — rather than being guessed from a clock afterwards.

Two attributions are decisions rather than lookups, and both are written down
here so the screen can say them out loud:

**A reply belongs to the poll that found its thread.** The replies stage stores
comments and sends them back through the filter. Those posts were collected by
no poll; the poll that found the parent is the honest answer and the only
useful one.

**A stage can outlive its poll.** `poll_runs` keeps 200 rows per monitor and
`stage_runs` keeps 800, so the column is nullable and the reference clears
itself when the poll is trimmed. A screen must be able to say "this walk, poll
unknown" — it will happen routinely, not rarely.

## Acceptance

- [x] Every stage run records the poll whose posts it processed, or null.
- [x] A retry records the same poll as the attempt it repeats.
- [x] A reply's filtering and scoring record the poll that found its thread.
- [x] A stage whose poll has been trimmed keeps its row and loses only the
      reference.
- [x] The notification sweep records no poll, as it records no walk.
- [x] A job sent by an older worker records null rather than refusing.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- The API in the hosted repository sends the field on; the grouping on the
  screen is US-210 and is somebody else's work.
- `on delete set null` rather than cascade: the poll row is trimmed on a
  schedule and the stage row is the longer record of the two.

## Log

- 2026-09-18T13:58+08:00 — Written after US-210 was raised against the flat
  collection that US-209 shipped.
- 2026-09-18T14:10+08:00 — Built it. The poll keeps the row `finish` wrote and
  sends its id with the posts, four lines later. A lookup instead would find
  whichever poll was running when the stage finished, which is wrong exactly
  when a walk holds three of them.
- 2026-09-18T14:10+08:00 — The trim case has its own test: a stage whose poll
  is deleted keeps its row, keeps its walk, and loses only the reference.
- 2026-09-18T14:10+08:00 — 2087 tests, lint and typecheck pass. The screen that
  reads this is US-210 in the hosted repository and is somebody else's.
