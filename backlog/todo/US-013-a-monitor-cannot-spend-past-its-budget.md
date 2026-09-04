---
id: US-013
title: A monitor cannot spend past its budget
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

The whole product runs on other people's API keys. That is the promise in
PLAN.md, and it only holds if the software can say what it spent and can be
told to stop.

Users will not connect a metered key to software that cannot report its
spending. It is a trust feature before it is a cost feature.

Two tables:

    api_usage   monitor_id, source, day, reads, estimated_cost_cents
    budget      monitor_id, monthly_cap_cents, on_exhausted (pause | notify)

The guard runs before a poll, not after. A check that runs after the call has
already spent the money.

The number that matters is the one the connector reports, not one derived from
the post count. A search that returns 40 posts may have been billed for more,
and a failed call may still have been billed. This is why
[US-006](US-006-x-returns-candidate-posts-and-says-what-it-spent.md) reports
consumed units rather than letting the caller count rows.

Our figure is an estimate and must be labelled one. The provider's invoice is
authoritative. Showing a number without that caveat invites a support argument
we cannot win.

## Acceptance

- [ ] Every source call records reads and estimated cost against the monitor
      and the day
- [ ] A monitor has a monthly cap and an exhausted behaviour: pause or notify
- [ ] The guard runs before a poll and refuses to start one that would exceed
      the cap
- [ ] A refused poll is visible in the UI with the reason, not silently skipped
- [ ] Spend to date and remaining budget show next to each monitor
- [ ] Model and embedding costs are recorded alongside source costs, so the
      total is the true total
- [ ] Figures are labelled as estimates, and the documentation says the
      provider's invoice is authoritative
- [ ] A monitor with no cap set still records usage

## Notes

- Ships with [US-006](US-006-x-returns-candidate-posts-and-says-what-it-spent.md).
  A metered source without a cap discovers its first cursor bug on a user's
  invoice.
- Depends on [US-007](US-007-the-worker-runs-jobs-on-a-schedule.md) for the
  poll it guards.
- STACK.md, *Budgets belong in the data model*.
- `pg-boss` throttling makes the poll interval a second cost dial. Both belong
  on the same screen.

## Log

- 2026-09-04 — Written from STACK.md.
- 2026-09-05 — Raised from p2 to p1. X lost its free tier: since February 2026
  pay-per-use is the only self-serve path, so the first X read a user makes is
  billed. A cap that lands after the connector is a cap that lands after the
  first surprise invoice. See STACK.md, *X*.
