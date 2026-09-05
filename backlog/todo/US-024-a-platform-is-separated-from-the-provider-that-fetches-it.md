---
id: US-024
title: A platform is separated from the provider that fetches it
type: chore
priority: p1
created: 2026-09-05T15:23+08:00
parent:
area:
resolution:
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

- [ ] `packages/core/src/sources/types.ts` describes a platform and a provider
      as separate records, and each field's comment says which axis owns it
- [ ] `billableUnit`, `pricePerUnitMicros` and `maxUnitsPerQueryPoll` belong to
      the provider and platform together, not to the platform
- [ ] `credentialFields` belongs to the provider; one key serves every platform
      that provider fetches
- [ ] The registry resolves a platform and provider pair, and refuses an
      unregistered pair with a message naming both
- [ ] Bright Data moves to `sources/providers/brightdata/reddit.ts`; platform
      descriptors live apart from provider code
- [ ] A migration adds a provider column to `api_usage`, and its unique key
      becomes monitor, platform, provider and day
- [ ] A migration adds a provider column to `source_continuations`, and its
      unique key becomes monitor, platform and provider
- [ ] A migration adds a nullable provider column to `posts`, and
      `UNIQUE (source, external_id)` is unchanged
- [ ] A migration re-keys `source_credentials` by provider, and the stored
      Bright Data key moves from `reddit` to `brightdata` without a person
      pasting it again
- [ ] `environmentVariableFor` names the provider, so the variable is
      `BRIGHTDATA_API_KEY`; `REDDIT_API_KEY` is read as a fallback and logs
      that it is deprecated
- [ ] The budget guard prices a poll from the provider's number, and its tests
      pass with no assertion edited
- [ ] The Reddit connector tests pass with no assertion edited
- [ ] `docs/sources.md` gives the steps for adding a platform and for adding a
      provider, as two lists
- [ ] STACK.md, *A source is not a provider*, and the AGENTS.md decision table
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
