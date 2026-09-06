---
id: BUG-005
title: The cost test prices every monitor as hourly
type: bug
priority: p2
created: 2026-09-06T12:57+08:00
parent: US-041
area:
resolution:
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

- [ ] The estimate projects from the schedule the person chose, not from an
      hourly assumption
- [ ] A monitor whose schedule names days polls fewer times a month than one
      that does not, and the projection says so
- [ ] The form's schedule control and its cost estimate agree. A test drives
      one screen and asserts both
- [ ] Changing the schedule after an estimate re-prices it, or the screen says
      the estimate is stale
- [ ] docs/costs.md says what the projection assumes now, in the same voice as
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
