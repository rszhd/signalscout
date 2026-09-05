---
id: US-024
title: A platform is separated from the provider that fetches it
type: chore
priority: p1
created: 2026-09-05T15:23+08:00
parent:
area:
resolution: done
---

## Context

Until now one provider served one platform, so one object could describe both.
`SourceDefinition` carries the platform (`id: "reddit"`, `displayName`) and the
provider facts (`credentialFields`, `billableUnit`, `pricePerUnitMicros`,
`maxUnitsPerQueryPoll`) in the same record, and Bright Data lives inside
`sources/reddit/`.

That stops working the moment two providers fetch the same platform.
ScrapeCreators and Bright Data will not bill the same unit at the same price
for Reddit, and one Bright Data key serves Reddit, X and LinkedIn together. A
record that holds one price and one key list cannot say either thing.

So the two axes separate:

* **A platform** is what a person ticks. It keys `posts.source`, it keys
  deduplication, and a monitor names it.
* **A provider** is who fetches, whose key it is, and what it bills. Price,
  billable unit, poll ceiling and credential fields all move here.
* A working connector is the pair.

This reverses a decision, and the reversal is deliberate. STACK.md, *A source
is not a provider*, said the product offers one provider per source and never
asks a person to choose. AGENTS.md listed a provider picker in the UI as
rejected. Both were right while Reddit had one usable provider. They are wrong
now that a person may hold a ScrapeCreators account, a Bright Data account, or
both. The architecture rule underneath does not change: the interface is not
weakened to suit a provider, and nothing downstream of a connector learns which
provider answered.

**Nothing this ticket does changes behaviour.** Bright Data keeps collecting
Reddit, on the same key, at the same price. The evidence that the split is
correct is that the existing tests pass with no assertion edited. If an
assertion has to move, the split is wrong.

Four columns are keyed by platform today and must carry the provider as well.
`api_usage` and `source_continuations` need it because both describe work one
provider did. `source_credentials` needs it because a key belongs to the
account, not to the network: keyed by platform, one Bright Data key is stored
three times and rotated three times. `posts` needs a provider column for
attribution only, and it must stay out of `UNIQUE (source, external_id)` — the
same Reddit post collected through two providers is one post and must never be
two rows.

## Acceptance

- [x] `packages/core/src/sources/types.ts` describes a platform and a provider
      as separate records, and each field's comment says which axis owns it
- [x] `billableUnit`, `pricePerUnitMicros` and `maxUnitsPerQueryPoll` belong to
      the provider and platform together, not to the platform
- [x] `credentialFields` belongs to the provider; one key serves every platform
      that provider fetches
- [x] The registry resolves a platform and provider pair, and refuses an
      unregistered pair with a message naming both
- [x] Bright Data moves to `sources/providers/brightdata/reddit.ts`; platform
      descriptors live apart from provider code
- [x] A migration adds a provider column to `api_usage`, and its unique key
      becomes monitor, platform, provider and day
- [x] A migration adds a provider column to `source_continuations`, and its
      unique key becomes monitor, platform and provider
- [x] A migration adds a nullable provider column to `posts`, and
      `UNIQUE (source, external_id)` is unchanged
- [x] A migration re-keys `source_credentials` by provider, and the stored
      Bright Data key moves from `reddit` to `brightdata` without a person
      pasting it again
- [x] `environmentVariableFor` names the provider, so the variable is
      `BRIGHTDATA_API_KEY`; `REDDIT_API_KEY` is read as a fallback and logs
      that it is deprecated
- [x] The budget guard prices a poll from the provider's number, and its tests
      pass with no assertion edited
- [x] The Reddit connector tests pass with no assertion edited
- [x] `docs/sources.md` gives the steps for adding a platform and for adding a
      provider, as two lists
- [x] STACK.md, *A source is not a provider*, and the AGENTS.md decision table
      record the reversal and its date

## Notes

- This is the largest ticket of the four. If it does not fit one session, split
  it at the migration boundary: the interface, the registry and the folder move
  first, the four migrations second. Link the parts with `parent:`.
- One migration number, one file. Four migrations here means four numbers.
- `environmentVariableFor` changing shape is breaking for an existing install.
  The fallback keeps a running instance working; the README says the old name
  is going.
- The credential re-key must run before US-025, or a ScrapeCreators key has
  nowhere to live.
- Read [docs/secrets.md](../../docs/secrets.md) before touching
  `source_credentials`, and [docs/costs.md](../../docs/costs.md) before moving
  a price.

## Log

- 2026-09-05T15:23+08:00 — Written after a product decision to support
  ScrapeCreators and Bright Data together. The decision reverses STACK.md's
  one-provider-per-source rule; this ticket carries the reversal.
- 2026-09-05T16:41+08:00 — Done in one session, not split. The four migrations
  are 0012 to 0015.

  **Nothing changed behaviour, and the test suite is the evidence.** 666 tests
  pass. No expected *value* moved except where the ticket asked for one: the
  environment variable is `BRIGHTDATA_API_KEY` rather than `REDDIT_API_KEY`,
  and the connections routes and screen are keyed by provider. Accessors moved
  — `reddit.displayName` is `reddit.platform.displayName` — but the values they
  read are the ones that were there before: "Reddit", "record", 1500, and the
  same credential field.

  **The re-key was the hard part, and it needed a column.** The cipher
  authenticates the record name, so a row sealed as `reddit:apiKey` cannot be
  opened as `brightdata:apiKey`. Deriving the name from the new key would have
  refused to boot on the one machine that had a working key. So the row carries
  what it was sealed with, in `source_credentials.record`, and every write sets
  it to the current name — a row normalises itself the first time it is
  replaced or rotated.

  That was proven against a real database, not argued: migrate to 0011, store a
  key the old way under `reddit`, run 0012 to 0015, read it back through the new
  code. The row came out `provider: brightdata`, `record: reddit:apiKey`, and
  the value read back was the same key. A rewrite then moved `record` to
  `brightdata:apiKey` and it stayed readable.

  **`scrapecreators` is in the `providers` enum with no connector behind it.**
  Two reasons, and neither is a guess about US-025's design. This ticket's own
  note says the re-key must run before US-025 or a ScrapeCreators key has
  nowhere to live. And a column whose only legal value is `brightdata` cannot
  show that the new unique keys separate two providers at all — the two schema
  tests that prove it need a second value. No route can write it while nothing
  is registered under it.

  **`registry.only(platform)` is the seam US-025 has to open.** A monitor names
  a platform and nothing yet records which provider it wants, so every caller
  that has one and not the other goes through `only`, which throws
  `AmbiguousConnectorError` when a platform has two providers. Registration
  order is not a choice: answering with the first would spend somebody's money
  at a provider they did not pick. The callers of `only` are the list of places
  US-025 must give a choice to — today `worker/collect.ts` and
  `worker/estimate.ts`.

  **The connections screen changed shape, and the ticket did not list it.** It
  had to: `credentialFields` moved to the provider, so a screen keyed by
  platform would ask for one Bright Data key once per platform. A card is now
  the account a person holds, and it names the platforms that key unlocks, so
  somebody connecting Reddit still reads "Reddit". The routes are
  `/api/connections/:provider`.

  **Not run live.** No provider was called. The split is proven by the suite and
  by the migration rehearsal above, and the first live poll after this is what
  proves the collector still spends money the same way.
