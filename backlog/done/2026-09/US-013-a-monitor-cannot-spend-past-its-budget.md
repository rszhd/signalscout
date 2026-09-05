---
id: US-013
title: A monitor cannot spend past its budget
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
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
[US-006](../../todo/US-006-x-returns-candidate-posts-and-says-what-it-spent.md) reports
consumed units rather than letting the caller count rows.

Our figure is an estimate and must be labelled one. The provider's invoice is
authoritative. Showing a number without that caveat invites a support argument
we cannot win.

## Acceptance

- [x] Every source call records reads and estimated cost against the monitor
      and the day
- [x] A monitor has a monthly cap and an exhausted behaviour: pause or notify
- [x] The guard runs before a poll and refuses to start one that would exceed
      the cap
- [x] A refused poll is visible in the UI with the reason, not silently skipped
- [x] Spend to date and remaining budget show next to each monitor
- [x] Model and embedding costs are recorded alongside source costs, so the
      total is the true total
- [x] Figures are labelled as estimates, and the documentation says the
      provider's invoice is authoritative
- [x] A monitor with no cap set still records usage

## Notes

- Ships with [US-006](../../todo/US-006-x-returns-candidate-posts-and-says-what-it-spent.md).
  A metered source without a cap discovers its first cursor bug on a user's
  invoice.
- Depends on US-007 for the poll it guards.
- STACK.md, *Budgets belong in the data model*.
- `pg-boss` throttling makes the poll interval a second cost dial. Both belong
  on the same screen.
- **The last box waited on
  [US-008](US-008-a-cheap-filter-runs-before-the-model.md), and
  closed with it.** Model calls are recorded and summed — classification, query
  generation and now the pre-filter's embeddings, refusals included. They land
  in the same sum with no change to the guard, which is what the `model_calls`
  design predicted. One caveat, stated rather than hidden: we carry no price
  table for embedding models, so an embedding is recorded with a null cost
  until `AI_EMBEDDING_PRICE_MICROS` is set, and null means "we cannot say" —
  the same convention as an unpriced chat model. docs/costs.md says so.
- The guard cannot forecast, so a cap can be overshot by one poll. That is not
  a defect in it. A page is billed when it is fetched, and the connector
  decides how many records a query collects, so the only place to tell a
  person the cost is before the query is written:
  [US-014](US-014-a-querys-cost-is-known-before-it-runs.md).
  `maxPagesPerPoll` bounds the overshoot meanwhile.
- STACK.md sketches the money columns as cents. They are micro-dollars, for
  the reason `model_calls` already used them: one classification costs about a
  tenth of a cent, and a cents column would record a month of classification
  as zero.

## Log

- 2026-09-04T22:49+08:00 — Written from STACK.md.
- 2026-09-05T00:46+08:00 — Raised from p2 to p1. X lost its free tier: since February 2026
  pay-per-use is the only self-serve path, so the first X read a user makes is
  billed. A cap that lands after the connector is a cap that lands after the
  first surprise invoice. See STACK.md, *X*.
- 2026-09-05T08:34+08:00 — Built. `api_usage` and `budgets` are migration 0007. The rule is
  `packages/core/src/budget/budget.ts`, written after its assertions because
  docs/testing.md names this one of the five correctness-critical surfaces. The
  guard runs at the top of `worker/collect.ts`, before any source is reached,
  and `pause` writes `paused_at` while `notify` leaves the monitor running so
  it resumes by itself next month. Usage is written after every page, not once
  per poll: a poll that throws on its third page was billed for the first two,
  and one of the tests is that failure. `apps/web` gained a third screen, the
  monitor list, because two acceptance boxes ask for something to sit next to
  each monitor and nothing listed them.
- 2026-09-05T08:34+08:00 — Six deliberate mutations of the guard and three of the poll step
  were each confirmed to turn the suite red, one at a time: the cap made
  exclusive, a negative remainder reported, a day's row replaced instead of
  added to, the month boundary dropped, the pause applied to a monitor that
  asked to be notified, and the pause never applied. Three more on the screen.
  379 tests pass.
- 2026-09-05T08:34+08:00 — What is unproven. The guard has never refused a real poll, and
  no usage row has been written from a live collection. The arithmetic is only
  as good as its two inputs — the units a connector reports and the price it
  declares — and neither has been checked against an invoice. docs/costs.md
  lists four ways the estimate is known to be wrong, starting with Bright
  Data's free allowance, which this code does not model at all.
- 2026-09-05T12:33+08:00 — Closed. US-008 wrote the embedding calls into `model_calls`,
  and `worker/filter.test.ts` asserts that one lands in `monitorSpend`, which
  is where the guard reads it. That was the last open box. Nothing about the
  guard changed; the missing half arrived, as the ticket said it would.
