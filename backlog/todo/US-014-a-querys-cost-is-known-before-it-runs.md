---
id: US-014
title: A query's cost is known before it runs
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

On a metered source the money is spent at fetch time, before any filter or
model sees the text. So the pre-filter cannot save a user from a bad query.
Only a better query can.

A user writing a monitor has no way to tell a narrow query from a broad one.
The word that seems specific to them may be common on X. They find out from
the invoice.

This adds a test step to monitor creation: run the query once against a small
sample, show how many posts it would return per day and what that costs at the
source's price, then let the user narrow it before the monitor starts.

The step itself costs money, which is the honest tension in this ticket. It
must sample rather than fetch a full page, it must say what the test itself
cost, and it must be a button the user presses rather than something that runs
on every keystroke.

For Reddit the number shown is a volume, not a price, because free-tier reads
cost nothing. The screen should not invent a cost that does not exist.

## Acceptance

- [ ] A test action on the monitor form runs each generated query once against
      a small sample
- [ ] The result shows estimated posts per day per query
- [ ] For a metered source it also shows the estimated monthly cost at the
      source's own price
- [ ] For a free source it shows volume only, and no invented price
- [ ] The cost of the test itself is shown and recorded in `api_usage`
- [ ] The test runs only when the user presses it
- [ ] A query estimated to exceed the monitor's cap is flagged before the
      monitor can be started
- [ ] A few sample matched posts are shown, so the user can judge quality and
      not only volume

## Notes

- Depends on [US-010](US-010-a-monitor-is-created-from-four-answers.md) and
  [US-013](US-013-a-monitor-cannot-spend-past-its-budget.md).
- STACK.md, *Query precision is a cost lever*.
- Showing sample posts is the part users will value most. Volume tells them
  what it costs; the samples tell them whether it is worth it.

## Log

- 2026-09-04 — Written from STACK.md.
- 2026-09-05 — Raised from p2 to p1, with US-013 and for the same reason: X
  bills every read and has no free allowance. A user cannot consent to a cost
  they are shown only after it is spent. Reddit through Bright Data adds a
  second reason — asking for comments doubles a monitor's cost, so the estimate
  must say so before the monitor runs.
