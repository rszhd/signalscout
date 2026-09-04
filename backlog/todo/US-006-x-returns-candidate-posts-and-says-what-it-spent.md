---
id: US-006
title: X returns candidate posts and says what it spent
type: feature
priority: p2
created: 2026-09-04
parent:
area:
resolution:
---

## Context

X is the second source in PLAN.md and the first one that costs money per post.

Pricing is pay-per-use with no subscription: $0.005 per post read, capped at
3 million reads per billing cycle, no free tier. About $25 buys 5,000 reads,
or roughly 165 posts a day. The old $200 Basic tier is gone.

That price changes how the connector is judged. Fetching a post costs about
five times more than classifying it, so the expensive mistake is not a slow
filter — it is a query that pulls posts nobody wanted, or a cursor bug that
pulls the same window twice.

This connector therefore reports what it consumed on every call, and it must
be exact rather than estimated. The budget guard in
[US-013](US-013-a-monitor-cannot-spend-past-its-budget.md) is built on that
number, and a guard fed a guess is not a guard.

**This ticket and US-013 ship together.** Shipping a metered source without a
spending cap means the first cursor bug is discovered on a user's invoice.

## Acceptance

- [ ] An X connector implements `SocialSource`
- [ ] The user's own bearer token is used; an invalid token fails validation
      with a message that names what to fix
- [ ] Every call reports the exact number of billable post reads it consumed
- [ ] A cursor is stored per query and sent on the next poll; a test asserts
      that two consecutive polls over an unchanged timeline consume no reads
      for posts already stored
- [ ] Rate limit responses are handled inside the connector with a back-off
- [ ] A partial page or a mid-page error records the reads already consumed;
      spend is never lost because a call failed
- [ ] Tests run against recorded fixtures, and no test hits the live API
- [ ] The setup documentation states the per-read price and what a typical
      monitor costs per month

## Notes

- Depends on [US-003](US-003-a-source-implements-one-interface.md).
- Ships with [US-013](US-013-a-monitor-cannot-spend-past-its-budget.md). Not
  after it.
- STACK.md, *Source economics*.
- Pricing changes. Keep the per-read price in one place, sourced from the
  connector, so a change is a one-line edit.

## Log

- 2026-09-04 — Written after checking current X pricing: pay-per-use replaced
  the fixed tiers, and the $200 Basic tier was retired.
