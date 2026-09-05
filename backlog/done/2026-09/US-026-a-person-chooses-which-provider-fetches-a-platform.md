---
id: US-026
title: A person chooses which provider fetches a platform
type: feature
priority: p2
created: 2026-09-05T15:23+08:00
parent:
area:
resolution: done
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

- [x] A default provider per platform is stored, and the store survives a
      restart
- [x] With one provider connected, that provider is used and no choice is shown
- [x] With both connected, settings shows one row per platform with the
      provider chosen
- [x] With no connected provider supporting a platform, the platform is shown
      as unavailable with a reason; a monitor cannot be started on it
- [x] The connections screen lists providers separately, and never implies both
      are required
- [x] The monitor form names platforms only; it does not ask for a provider
- [x] Changing the default does not resume a collection that another provider
      started, asserted by a test
- [x] Changing the default takes effect on the next collection, asserted by a
      test
- [x] `api_usage` attributes spend to the provider that ran the poll, so a
      switch splits the month's spend rather than merging it
- [x] The inbox or the monitor list can say which provider last collected a
      platform, and when

## Notes

- Depends on [US-024](../done/2026-09/US-024-a-platform-is-separated-from-the-provider-that-fetches-it.md)
  and [US-025](../done/2026-09/US-025-scrapecreators-collects-reddit-posts.md). Before US-025
  there is nothing to choose between.
- The store is one small table, platform to provider. It does not need a row
  per platform: an absent row means the only connected provider.
- `apps/web/src/Connections.tsx` and `apps/api/src/connections.ts` already hold
  the credential screen. This extends them; it does not start a second screen.
- A per-monitor override is deliberately out of scope. Write a ticket when
  somebody asks.
- The seam already exists. US-025 gave `createSourceRegistry` a
  `defaultProviders` option, because a second Reddit connector made
  `registry.only` ambiguous and the live proof needed a way to choose. It is
  filled from `REDDIT_PROVIDER` today. This ticket fills it from the store
  instead and deletes the variable from `env.ts`, `.env.example` and the
  README; it does not need a new mechanism.

## Log

- 2026-09-05T15:23+08:00 — Written with the provider decision. Global per
  platform, because it is the simpler thing that answers the question asked.
- 2026-09-05T18:10+08:00 — Unblocked: US-025 shipped the second provider, so
  there is now something to choose between. It also left `REDDIT_PROVIDER`
  behind as the temporary answer, which this ticket removes.

- 2026-09-05T19:12+08:00 — Closed. The store is `source_providers`, one row per
  platform, and no row is the normal state.

  The rule moved out of `only` and into `decideProvider`, which is a value and
  not a throw, because two callers need the same answer and only one of them is
  polling: `only` turns each branch into the error that names its repair, and
  the connections screen turns the same branch into the sentence a person
  reads. A screen with its own copy of the rule is a screen that calls a
  platform ready while every poll of it is refused.

  Two things in the rule were not in the ticket, and both are about money.

  **"Can run" is not "is registered".** The build ships two Reddit connectors
  and almost every deployment holds one of the two keys, so a rule reading only
  the registry would ask every one-key install to choose between an account it
  has and one it does not. `ChoiceOptions.among` is the caller saying what it
  can run; the poll fills it from the keys it holds.

  **A choice that cannot run is refused, not replaced.** A person who chose
  ScrapeCreators and lost its key would otherwise have every poll moved to
  Bright Data, which charges twenty times as much for the same subreddit page —
  silently, and in the same monthly cap. `startBlockers` narrows the same way,
  so the form and the poll agree: a monitor whose chosen provider has no key
  cannot start, rather than starting and refusing every poll for ever.

- 2026-09-05T19:14+08:00 — Two things were found on the way and fixed here,
  because both are US-025's split left half done and both cost money.

  `/api/monitor-options` listed one row per *connector*, so the monitor form
  showed Reddit twice the moment a second provider existed. It lists platforms
  now, and it no longer carries a price at all: the price belongs to the pair,
  and a figure printed beside a platform is one provider's arithmetic on the
  other's bill.

  The cost test had the same fault twice over. `query_estimate_probes` carried
  no provider, so a report found its descriptor by platform alone and priced
  every sample at whichever connector was registered first — a ScrapeCreators
  sample projected at Bright Data's rate is out by twenty times. A probe holds
  a cursor as well, so a changed choice would have resumed one provider's
  sample through the other. The column fixes both.

- 2026-09-05T19:16+08:00 — `REDDIT_PROVIDER` is gone from `env.ts`,
  `.env.example` and the README, as the ticket asked. Nothing reads it at boot,
  so an instance that still sets it is not broken by it; the connections screen
  is where the answer lives now.

  Six new tests carry the two correctness boxes. Changing the choice moves the
  next collection and leaves the running one alone: the resume goes back to
  Bright Data with its own cursor and ScrapeCreators is never called. A switch
  leaves two `api_usage` rows, 4 units at $0.0015 and 1 at $0.00376, priced by
  the connector that ran rather than by the platform.

  Both providers in every test are the fake, so what the suite proves is our
  half: the rule, the store, the two screens and the ledger. The live switch is
  the next entry.

- 2026-09-05T19:41+08:00 — The switch was made live, mid-collection, for
  $0.0788. `live:provider-switch` is the script, and it is committed: this is a
  claim about two third-party providers, so the next person to touch
  `collect.ts`'s provider selection needs to be able to ask them again.

  What happened, on r/softwaretesting:

  | | |
  |---|---|
  | Bright Data collection triggered | cursor `subreddit\|sd_mto9lmkh1w5v9syrux\|0` |
  | Choice moved to ScrapeCreators | 1.0 s later, snapshot still collecting |
  | Resumes | 4, every one to Bright Data, with Bright Data's cursor |
  | ScrapeCreators asked during that | never |
  | Snapshot closed | 2 min 13 s, 50 records, $0.075 |
  | Next collection | ScrapeCreators, 47 posts, 2 requests, $0.00376 |
  | `api_usage` | two rows, one per provider, each priced by its own connector |

  So the ticket's correctness point holds against the real thing: a collection
  in flight belongs to the provider that started it, and the switch reached the
  next collection and not that one.

  Three measurements came out of it that were not the point.

  **The same subreddit cost twenty times less through ScrapeCreators**, minutes
  apart rather than on separate days. US-025 measured $0.075 against $0.00376
  and this run repeats it back to back.

  **Bright Data's snapshot was ready in 2 minutes 13 seconds**, against
  US-022's 8 minutes 40. That figure is a sample, not a constant, and
  docs/sources.md now says both.

  **The run stored no new post.** All 50 records and all 47 posts were already
  in the table from the earlier runs, and `posts` stayed at 174 throughout.
  Deduplication across two providers, live, again.

  The migrations also went on to a database that already held 174 posts, 5
  monitors and a real encrypted credential — the existing-database case, rather
  than the empty one every test file creates.

  The dev database keeps the evidence: a paused monitor named "US-026 live
  provider switch", its two `api_usage` rows, and `reddit → scrapecreators` in
  `source_providers`. That last one matches what `REDDIT_PROVIDER` had been set
  to, so the deployment's intent survived the variable being deleted.

  Still unproven for this rule: a switch on a platform whose two providers both
  hold *keyword* collections, and what a provider does when a snapshot expires
  mid-switch. Neither is reachable without waiting for a failure we cannot
  cause.