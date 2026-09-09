---
id: US-084
title: A new monitor starts with a cap and a slower clock
type: feature
priority: p2
created: 2026-09-09T10:12+08:00
parent: US-041
area: web
resolution: done
---

## Context

**Step 5 of the new-monitor form offers two dials that decide the whole bill,
and both are set to their most expensive answer.** The budget field is empty,
which the form calls "no cap", and the rate is hourly. A person who reads
neither control gets an uncapped monitor polling 731 times a month.

That was a deliberate choice in US-041 — a monitor that finds nothing on its
first day looks broken — and the owner has now decided the other way. Two
measurements support it. US-007 measured a monitor at the 60-second floor
billing 9 to 11 records a poll and returning no posts, because everything it
found was older than the last poll; poll frequency is the largest cost dial
here. And US-014's arithmetic says the same query costs $10.80 a month polled
hourly against $1.80 polled every six hours.

**An empty budget is the worse of the two.** The guard cannot refuse what has
no cap, so the only thing standing between a mistyped query and a month of
spending is a person noticing. US-013's guard is written and tested; a form
that defaults past it wastes it.

Three details decide how this is built.

* **$5 is a starting amount, not a ceiling.** It is above one live LinkedIn
  poll ($0.081), one Instagram poll ($1.63) and a month of one keyword at six
  hourly ($1.80), and below the $10.80 an hourly keyword costs. So the common
  first monitor runs, and an expensive one meets the "Save without starting"
  path the form already has rather than a surprise.
* **Required means required on this form only.** `budgets` stays nullable,
  `POST /api/monitors` keeps `budget` optional, and the budget can still be
  deleted from Monitors afterwards. A monitor older than this change has no
  cap and must go on polling. The rule is about the moment somebody creates
  one, which is the moment they are thinking about the money.
* **Every day stays.** `pollDays` already defaults to the whole week and this
  ticket does not move it. Only the interval changes.

## Acceptance

- [x] The budget field on step 5 starts at `5`, and a monitor created without
      touching it is sent `monthlyCapMicros: 5_000_000`.
- [x] Clearing the budget field and submitting is refused with a sentence that
      says a cap is required. No request is made.
- [x] The field's own words no longer offer "leave it empty for no cap".
- [x] A new monitor's schedule starts at every 6 hours, every day, and the
      count under the control says about 122 polls a month.
- [x] "Create another monitor" resets both to the same defaults.
- [x] `POST /api/monitors` still accepts a body with no budget, and a monitor
      that has no budget row still polls. Nothing in the API or the core
      changed.

## Notes

The reset path matters more than it looks: `reset()` is what "Create another
monitor" calls, and a second monitor created in one sitting is the one most
likely to be created without reading step 5 again.

## Log

- 2026-09-09T10:12+08:00 — Written.
- 2026-09-09T10:41+08:00 — Done. `defaultRate` is six hours, the budget field
  starts at `5` and an empty one is refused before any request is made. Nothing
  in the API or the core moved: `budget` is still optional on `POST
  /api/monitors`, the budget row is still nullable and still deletable from
  Monitors, so a monitor made before today goes on polling uncapped.

  Two existing tests changed, and both because the behaviour was meant to
  change. The over-cap test's mocked estimate said `pollIntervalSeconds: 3600`,
  which the form would now read as a stale answer measured at another rate, so
  it says 21,600. And the untested-plan test asserted `payload.budget` was
  absent; it now asserts the $5 cap, which is the point of the ticket.

  Three new assertions cover the paths a person actually takes: the default cap
  travelling in the body, whitespace in the field being refused with no request
  made, and "Create another monitor" bringing back both defaults rather than
  the last monitor's answers.

  The whole suite passes: 1,589 tests in 93 files. No live provider was called
  and nothing was spent.
