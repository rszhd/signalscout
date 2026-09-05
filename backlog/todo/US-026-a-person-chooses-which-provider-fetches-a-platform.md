---
id: US-026
title: A person chooses which provider fetches a platform
type: feature
priority: p2
created: 2026-09-05T15:23+08:00
parent:
area:
resolution:
---

## Context

Once two providers fetch Reddit, something has to decide which one runs. This
ticket makes that decision explicit, and keeps it out of the monitor form.

The product rule is that a person is never required to hold both accounts. So
the common case has no choice in it at all:

* one provider connected — it is used, and no question is asked;
* both connected — the person picks a default for each platform;
* neither supports a platform — the platform is shown as unavailable, with the
  reason, and never fails quietly at poll time.

The choice is **global for each platform**, not per monitor. A person who
wants Reddit through Bright Data wants it for every monitor, and a per-monitor
override is a setting nobody has asked for yet. Adding it later costs one
column. Shipping it now costs a screen and an explanation.

One correctness point sits under this. A collection in flight belongs to the
provider that started it. US-024 puts the provider in
`source_continuations`, so changing the default must never resume a Bright Data
snapshot through ScrapeCreators — that reads a cursor the new provider cannot
understand, and on a provider that bills at collection time it also pays twice.
The switch takes effect on the next collection, and the collection already
running finishes where it started.

The UI must not turn into scraping infrastructure. A person chooses networks to
watch. The provider is a line in settings, named in secondary text, and the
monitor form does not mention it.

## Acceptance

- [ ] A default provider per platform is stored, and the store survives a
      restart
- [ ] With one provider connected, that provider is used and no choice is shown
- [ ] With both connected, settings shows one row per platform with the
      provider chosen
- [ ] With no connected provider supporting a platform, the platform is shown
      as unavailable with a reason; a monitor cannot be started on it
- [ ] The connections screen lists providers separately, and never implies both
      are required
- [ ] The monitor form names platforms only; it does not ask for a provider
- [ ] Changing the default does not resume a collection that another provider
      started, asserted by a test
- [ ] Changing the default takes effect on the next collection, asserted by a
      test
- [ ] `api_usage` attributes spend to the provider that ran the poll, so a
      switch splits the month's spend rather than merging it
- [ ] The inbox or the monitor list can say which provider last collected a
      platform, and when

## Notes

- Depends on [US-024](US-024-a-platform-is-separated-from-the-provider-that-fetches-it.md)
  and [US-025](US-025-scrapecreators-collects-reddit-posts.md). Before US-025
  there is nothing to choose between.
- The store is one small table, platform to provider. It does not need a row
  per platform: an absent row means the only connected provider.
- `apps/web/src/Connections.tsx` and `apps/api/src/connections.ts` already hold
  the credential screen. This extends them; it does not start a second screen.
- A per-monitor override is deliberately out of scope. Write a ticket when
  somebody asks.

## Log

- 2026-09-05T15:23+08:00 — Written with the provider decision. Global per
  platform, because it is the simpler thing that answers the question asked.
