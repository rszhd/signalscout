---
id: US-006
title: X returns candidate posts and says what it spent
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution:
---

## Context

X is the second platform in PLAN.md and the first one where the read, not the
classification, is the expensive part.

This ticket was written when X meant one thing: X's own pay-per-use API, with
the person's own bearer token, at $0.005 per post read, no free tier. About $25
buys 5,000 reads, or roughly 165 posts a day. That is still true of X's own
API, and it is no longer the only way to reach X.

**X's own API is out of scope, by decision.** On 2026-09-05 the owner settled
it: X is reached through a data provider, the same way Reddit is. We do not ask
a user for an X bearer token and we do not build against X's endpoints. The
reason is the one Reddit taught us — a per-user platform key is a door the
platform can close, and X charges for every read behind it. This is now written
in STACK.md, *X*, and in the settled-decisions table in AGENTS.md.

**So this ticket delivers X through one provider, and which one is measured.**
US-024 separated the two axes, and both Bright Data and ScrapeCreators offer X.
Take the provider whose price and billable unit you can read, record the price,
the page and the date, and say in the Log why that one went first. A second
provider for X is a later ticket, and US-026 already decides how a person
chooses between them.

One number does not travel between providers. $0.005 is the price of one read
from X's own API. It says nothing about what a data provider charges, and
copying it onto another provider's descriptor would feed the budget guard a
figure nobody measured. `pricePerUnitMicros` comes from the provider that will
send the bill.

What has not changed is why the metering matters. Fetching an X post costs more
than classifying it, so the expensive mistake is not a slow filter — it is a
query that pulls posts nobody wanted, or a cursor bug that pulls the same
window twice. The connector reports what it consumed on every call, exactly and
not by estimate. The budget guard in
[US-013](../done/2026-09/US-013-a-monitor-cannot-spend-past-its-budget.md) is
built on that number, and a guard fed a guess is not a guard.

US-013 shipped, so this ticket no longer waits on it.

## Acceptance

- [ ] X is registered as a platform, with one provider fetching it through the
      interface US-024 settled, and that provider is Bright Data or
      ScrapeCreators — never X's own API
- [ ] The Log names the provider, its price, its billable unit, the page the
      price came from and the date it was read
- [ ] An invalid credential fails validation with the provider's own sentence,
      and an unreachable provider is a different answer
- [ ] Every call reports the exact number of billable units it consumed, in the
      provider's own unit
- [ ] A cursor is stored per query and sent on the next poll; a test asserts
      that two consecutive polls over an unchanged timeline consume nothing for
      posts already stored
- [ ] Rate limit responses are handled inside the connector with a back-off
- [ ] A partial page or a mid-page error records the units already consumed;
      spend is never lost because a call failed
- [ ] A migration adds `x` to the sources the schema accepts
- [ ] Tests run against fixtures captured from real responses by a committed,
      re-runnable script
- [ ] Captured payloads are stored whole, with identifying fields scrubbed, and
      no fixture is written from memory
- [ ] The connector takes an injected HTTP client, and the test setup makes the
      real one unreachable — a test that would spend money fails rather than
      spending it
- [ ] One live collection stores real posts; the Log holds the count, the cost
      and the elapsed time
- [ ] The setup documentation states the per-unit price and what a typical
      monitor costs per month

## Notes

- Depends on [US-024](US-024-a-platform-is-separated-from-the-provider-that-fetches-it.md).
  Adding X before the split would put a second provider-shaped record into a
  platform-shaped one.
- [US-013](../done/2026-09/US-013-a-monitor-cannot-spend-past-its-budget.md)
  and [US-014](../done/2026-09/US-014-a-querys-cost-is-known-before-it-runs.md)
  shipped. The cap and the estimate exist before the first billed X read.
- STACK.md, *X*, holds the decision and the one figure we have. $0.005 is X's
  own price and describes no provider.
- [docs/testing.md](../../docs/testing.md), *No test spends money* and *A
  fixture for someone else's API must be captured, not written*. The capture
  script costs a few reads once; a test loop against a live API bills
  continuously.
- Pricing changes. Keep the price in the provider's descriptor, so a change is
  a one-line edit.

## Log

- 2026-09-04T22:49+08:00 — Written after checking current X pricing: pay-per-use replaced
  the fixed tiers, and the $200 Basic tier was retired.
- 2026-09-04T22:54+08:00 — Added the captured-fixture and injected-client requirements,
  after adopting docs/testing.md. The injected client is what makes "no test
  spends money" enforceable rather than a convention.
- 2026-09-05T00:46+08:00 — Unchanged, but now sequenced behind US-013 and US-014, which were
  raised to p1. X has no free allowance, so the cap and the estimate land before
  the first billed read, not after it.

- 2026-09-05T21:36+08:00 — Decision from the owner: X comes through Bright Data
  or ScrapeCreators only. X's own API is out of scope, so no bearer token and
  no X endpoints. Nothing was built. The Context, the first acceptance box and
  one note were rewritten to say so, and AGENTS.md, STACK.md and README.md were
  corrected: three of them still told a reader that X arrives through its
  official pay-per-use API. No code carried an X price, so none was removed.
  The price of an X read at either provider is still unread, and this ticket
  reads it.
- 2026-09-05T15:23+08:00 — Rewritten for the two-provider decision. X is a platform
  now, not a provider, and this ticket delivers one provider for it. The $0.005
  price belongs to X's own API and must not be copied onto another provider.
  US-013 and US-014 have since shipped, so the sequencing note is history.
