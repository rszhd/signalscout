---
id: US-158
title: Reddit through Bright Data is switched off
type: chore
priority: p2
created: 2026-09-17T00:31+08:00
parent:
area:
resolution: shipped
---

## Context

**Bright Data is the dearest way this build reads a Reddit post, by about five
times.** A record costs $0.0015 and a record is one post, so fifty posts cost
$0.0750. The same fifty cost about $0.0134 through ScrapeCreators and about
$0.0162 through SocialCrawl. The numbers are in
[costs.md](../../docs/costs.md); none of them is new, and the owner decided on
2026-09-17 that the gap is too wide to keep offering the pair.

**Reddit keeps two providers, so the platform survives the switch.** US-053
built the mechanism for exactly this case and could not test it on LinkedIn,
which had one provider. Reddit has three. After this ticket it has two, and
collection, comments and the cost test all work through both.

**The switch costs deletion reconciliation, and that was not in the price
argument.** Bright Data is the only Reddit connector whose removal signal was
proved live. `capture:deletions` got an explicit deleted record and a
`dead_page` from it; ScrapeCreators answered the same 404 for a removed post
and for a live post asked for the wrong way, so its 404 is uncertain and leaves
the match visible. SocialCrawl's Reddit connector implements no `verify`, and
`reconcile.ts` skips a source without one. So a Reddit post deleted after it
was matched will usually stay in the inbox. The owner was told this after the
switch was built, not before; it is recorded here and in
[deletions.md](../../docs/deletions.md) so the trade is visible rather than
discovered. The repair is a measurement of the other two, not a code change.

**The free allowance is the argument against, and it is not enough.** Bright
Data gives the first 5,000 records each month at no cost, so a small instance
polling inside that allowance pays nothing at all, and SignalScout prices every
record at the paid rate anyway. Two things answer it. The allowance runs out at
five thousand posts a month, which is one busy monitor; and the connector is
slow where the others are not — a collection took 8 minutes 40 seconds and 2
minutes 13 on another day, against 1.8 to 4.9 seconds through ScrapeCreators.
A person on the free allowance is paying in latency instead.

**The connector is switched off, not deleted.** Its file, its client, its
fixtures, its tests and `capture:deletions` all stay. The decision is about the
pair: Bright Data at $0.0015 a Reddit post. A Bright Data dataset for another
platform, or a price change, is a reason to delete one field.

**A recorded choice naming Bright Data is refused, not moved.** That is
`decideProvider`'s second branch and it is the money case: an account that
chose Bright Data must be told to choose again, rather than have every poll
quietly billed to somebody else's key.

## Acceptance

- [x] `brightDataReddit` carries `notOffered`, and the sentence says what is
      wrong and what fetches Reddit instead
- [x] No production code changes. The switch is one field, which is US-053's
      claim — **and four test files had to move**, because each used Bright
      Data as its sample Reddit provider. That is the edge of the claim, and
      `docs/sources.md` now warns the next person about it
- [x] A test asserts the connector still registers, still prices itself per
      record, and is not offered
- [x] A test asserts Reddit is still offered by this build, through
      ScrapeCreators and SocialCrawl
- [x] `docs/sources.md`, `docs/costs.md`, `AGENTS.md`, `STACK.md` and
      `README.md` stop describing Reddit as having three usable providers
- [x] `.env.example` says the key buys nothing here now and the variable stays,
      because it is derived from `builtInSources` and the connector still
      ships. `.env.example.self-hosted` drops it: that file is the copy a
      person starts from, and it lists nothing that cannot be spent
- [x] `docs/instruments.md` says `live:provider-switch` is refused, the way it
      says so for `live:linkedin-poll`
- [x] `docs/deletions.md` says Reddit deletion checks are weak now, and why
- [x] The whole suite passes: 2,010 tests, of which 3 are this ticket's. No
      expected value moved except by naming a different provider

## Notes

- The prices are in `packages/engine/src/sources/providers/*/reddit.ts` and in
  the table in [costs.md](../../docs/costs.md). Nothing was re-measured for
  this ticket.
- `live:provider-switch` drives the real pipeline and records the Reddit choice
  as `brightdata`, so it now refuses. It is the instrument that proves a
  collection resumes through the provider that started it. Delete `notOffered`
  to run it again.
- Do not remove `brightdata` from `vocabulary.ts` or from the provider check
  constraint. Old `api_usage` rows and old `source_continuations` name it.
- The hosted repository depends on the published `@signalscout/engine`, so this
  switch reaches it only through a release and a version bump.

## Log

- 2026-09-17T00:31+08:00 — Written after the owner asked for Bright Data to be
  disabled. The mechanism was decided by US-053; this ticket is the decision
  that uses it.
- 2026-09-17T00:41+08:00 — Built. One field on the connector, and nothing else
  in production code. Fourteen tests went red in four files, all of them
  sampling Bright Data as a Reddit provider rather than testing it: they now
  sample ScrapeCreators, which is what the build offers. The mechanism itself
  needed no case — US-053's tests already covered a platform losing one of
  three providers, and they used fakes, so they never noticed.
- 2026-09-17T00:44+08:00 — Found while writing the documents that the price
  argument was incomplete. Bright Data is the only Reddit connector with a
  proved deletion signal, so the switch stops deleted Reddit posts leaving the
  inbox. Recorded in the connector, in deletions.md and in Context above. The
  decision stands; the cost is now written down where the next person will find
  it before they wonder why a removed post is still there.
- 2026-09-17T00:46+08:00 — Unproven: nothing here has run live. No poll has
  skipped Bright Data on a real machine, and no person has met the refusal on
  the connections screen. The suite covers our half only.
