---
id: BUG-005
title: The cost test prices every monitor as hourly
type: bug
priority: p2
created: 2026-09-06T12:57+08:00
parent: US-041
area:
resolution: shipped
---

## Context

US-014's cost test projects a month from a live sample, and its multiplier is
polls a month. That multiplier is hourly, because until US-041 every monitor
was hourly and there was nothing else it could be.

Now there is. A person can choose weekly, and the form will quote them a month
of **hourly** polling for it — 730 polls where the monitor will make 4. **Wrong
by a factor of about 180**, and wrong in the direction that frightens somebody
out of a monitor that would have cost them almost nothing.

The two halves of the same screen now disagree: the schedule control says a
weekly monitor makes about 4 polls a month, and the estimate beside it prices
730.

This is small and it is not cosmetic. docs/costs.md is careful about what an
estimate is wrong about, and it does not currently include *"it assumes an
interval you did not choose"*. Either the estimate reads the schedule, or that
sentence has to be added — and reading the schedule is the honest one.

## Acceptance

- [x] The estimate projects from the schedule the person chose, not from an
      hourly assumption
- [x] A monitor whose schedule names days polls fewer times a month than one
      that does not, and the projection says so
- [x] The form's schedule control and its cost estimate agree. A test drives
      one screen and asserts both
- [x] Changing the schedule after an estimate re-prices it, or the screen says
      the estimate is stale — **the second, deliberately.** An estimate records
      the schedule it priced, and a quote is a record of what somebody was told
      rather than a live query. docs/costs.md says so
- [x] docs/costs.md says what the projection assumes now, in the same voice as
      the four things it already admits

## Notes

- Found while building [US-041](../doing/US-041-a-person-chooses-when-a-monitor-runs.md),
  named there rather than folded into it quietly.
- `worker/estimate.ts` holds the arithmetic and `apps/web/src/schedule.ts` holds
  the choices with their polls-a-month. One of them should read the other rather
  than both carrying the number.
- US-014's own lesson still applies and is the easiest thing to break here:
  **cost comes from `unitsConsumed` and volume comes from posts.** Never price
  anything from a post count. That mistake cost $0.042 to find.

## Log

- 2026-09-06T12:57+08:00 — Written the moment US-041 made it true. The estimate
  was correct for as long as every monitor was hourly, which was until this
  afternoon.

- 2026-09-06T13:08+08:00 — Fixed, and the shape of the fix mattered more than
  the arithmetic.

  **`pollDays` is required on `PollShape`, not optional.** An optional one with
  a sensible default is exactly how this bug existed: the projection assumed
  every day, and nothing made a caller think about it. Required meant the
  compiler listed every caller — two in production, two in tests — and none of
  them could be forgotten. The fix itself is one line: polls a month now
  multiplies by `pollDays.length / 7`.

  **The estimate row stores the days**, beside the interval it already stored,
  for the same reason: an estimate is made before a monitor exists, and a
  projection is a record of what was quoted. A person who changes their schedule
  gets a stale estimate rather than a silently re-priced one.

  **The screen was the other half and it was worse.** `CostTest` never sent a
  schedule at all, so the API applied its default — hourly, every day — no
  matter what the control beside it said. It sends both now, and the sentence
  under the table names the days when they are not all seven.

  Two tests carry it: one asserts a weekdays monitor is quoted five sevenths of
  a daily one, and one asserts the number from this ticket's own title — hourly
  against weekly is more than 150 times, where it used to be 1.

  1,034 tests pass. Migration 0029.

