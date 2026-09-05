---
id: US-025
title: ScrapeCreators collects Reddit posts
type: feature
priority: p1
created: 2026-09-05T15:23+08:00
parent:
area:
resolution:
---

## Context

ScrapeCreators is the second provider. The product reason is that a person
should reach several networks with one key and one account, and Bright Data is
then the alternative rather than the requirement.

This ticket adds the provider for **Reddit only**, and it does that on purpose.
Reddit is the one path this repository has measured: US-022 carried a monitor
from the form to twenty scored matches through Bright Data, live. Adding a
second provider on that path means provider switching is proven against a
result we already trust. Adding it on a platform we have never collected would
prove nothing about either half.

**We have no measured evidence about ScrapeCreators.** Not the price, not the
billable unit, not whether a search answers at once or returns something to
poll, not the cursor shape, not what a refused key says. Every one of those is
a question this ticket answers with a captured response, and none of them may
be written from memory. A payload written from memory is evidence about our
parser and no evidence at all about the wire format.

The asynchronous question decides the shape of the connector. Bright Data
answers a large request with a snapshot to poll, which is why `NextPage` has a
`wait` state and why BUG-001 exists. If ScrapeCreators answers at once, the
connector returns `ready` and `done` only, and that is a measured fact worth
writing down rather than a simplification.

The price decides whether the budget guard works at all. `pricePerUnitMicros`
is the guard's only input. It comes from ScrapeCreators' own published price,
read on a recorded date, in whatever unit they actually bill — a request, a
result, a credit. If their unit is not a record, `billableUnit` says so, and
the cost test reports their number and not Bright Data's.

## Acceptance

- [ ] A ScrapeCreators provider fetches Reddit through the interface US-024
      settled, and nothing outside `sources/providers/scrapecreators/` names it
- [ ] `billableUnit` and `pricePerUnitMicros` come from ScrapeCreators' own
      published price; the ticket Log records the page and the date it was read
- [ ] `validateCredentials` refuses a wrong key with the provider's own
      sentence, and answers differently when the provider is unreachable
- [ ] The ticket records whether the credential probe was billed, measured
      against `api_usage` and the provider's own figures
- [ ] Whether a search answers at once or asynchronously is measured, and
      `next` reports what was measured
- [ ] Every call reports `unitsConsumed` in ScrapeCreators' unit, and it is
      never a post count
- [ ] Fixtures come from real responses through a committed, re-runnable
      capture script, stored whole with identifying fields scrubbed
- [ ] No test reaches ScrapeCreators; the test setup makes the real client
      unreachable
- [ ] One live collection stores real Reddit posts and records what it spent;
      the ticket Log holds the record count, the cost and the elapsed time
- [ ] A monitor set to Reddit through ScrapeCreators produces at least one
      match in the inbox, and the Log says what the top match was
- [ ] The same Reddit post collected through both providers is one row in
      `posts`, asserted by a test
- [ ] `posts.source` is still `reddit`; the provider is attribution only

## Notes

- Depends on [US-024](US-024-a-platform-is-separated-from-the-provider-that-fetches-it.md).
- Read [docs/sources.md](../../docs/sources.md) first. The three things
  connectors get wrong are the three this one will get wrong.
- The capture script is the instrument, not a convenience. Commit it beside the
  fixture.
- A live run costs money. Keep the sample small and record the figure, the way
  US-014's cost tests did.
- Do not add a second platform in this ticket. LinkedIn and X are their own
  tickets, and the second platform is where a wrong abstraction shows.

## Log

- 2026-09-05T15:23+08:00 — Written with the provider decision. Scoped to Reddit
  because Reddit is the only path measured end to end.
