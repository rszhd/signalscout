---
id: US-003
title: A source implements one interface
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution: shipped
---

## Context

PLAN.md sketches a `SocialSource` interface and says community contributors
should be able to add connectors. That only works if the interface is settled
before two connectors exist, not after. Two connectors written independently
produce two shapes, and the second one becomes the argument.

The sketch in PLAN.md has three members: `id`, `validateCredentials` and
`search`. Building Reddit and X against it will show what is missing. The
candidates, from what the sources actually do:

- **Cursor and cost are different things.** `search` returns posts and a
  cursor for the next page. It must also return how many billable units it
  consumed, because the caller cannot work that out from the post count alone.
- **Rate limits are the source's business.** Reddit sends
  `X-Ratelimit-Remaining` on every response. The connector reads it and backs
  off. The worker must not have to know that Reddit has headers and X does
  not.
- **A source declares its own price.** The budget guard needs a number per
  read. Hard-coding X's $0.005 in the worker puts a pricing fact in the wrong
  file.

This ticket writes the interface, the shared types, and a fake source that
implements it. The fake is not a test convenience; it is how every later
ticket tests the pipeline without spending money.

## Acceptance

- [x] `SocialSource` is defined in `packages/core/sources`, with no import of
      Fastify or React
- [x] The interface covers: identity, credential validation, search with a
      cursor, units consumed, and the per-unit price
- [x] Rate limiting and back-off are the connector's responsibility, and the
      interface makes that possible without the caller knowing the mechanism
- [x] A `fake` source implements the interface and returns fixture posts with
      no network call
- [x] The fake can be told to exhaust its rate limit and to return a partial
      page, so callers can be tested against both
- [x] A registry maps a source id to an implementation, and an unknown id
      fails loudly at startup rather than at poll time
- [x] Adding a connector requires touching the registry and one new folder,
      and nothing else — a test or a document demonstrates this

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- Blocks [US-005](../../todo/US-005-reddit-returns-candidate-posts.md) and
  [US-006](../../todo/US-006-x-returns-candidate-posts-and-says-what-it-spent.md).
- PLAN.md, *Architecture*, for the original sketch.
- The backlog's ordering precedent puts this early on purpose: a ticket that
  settles shared vocabulary goes first.
- The interface is `packages/core/src/sources/types.ts`. Each member's comment
  says why it exists. [docs/sources.md](../../../docs/sources.md) is the
  contributor's page: the steps, the runtime, and the three things connectors
  get wrong.
- `builtInSources` ships empty. US-005 adds Reddit and US-006 adds X. The list
  exists now so the second connector is not the one that decides the shape.

## Log

- 2026-09-04 — Written from PLAN.md. The three additions to PLAN.md's sketch
  are proposals; the work settles them.
- 2026-09-04 — Shipped. All three proposals are in. `search` returns
  `unitsConsumed` in the source's own `billableUnit`, because Reddit bills one
  call for up to 100 posts and X bills every post read, so the same page costs
  differently and the caller cannot compute it. `pricePerUnitMicros` sits on
  the descriptor, so the budget guard reads a price and the worker holds none.
  Back-off is the connector's: `SourceRuntime` gives it `now` and `sleep`, and
  `NextPage` lets it hand the remainder up as `{ status: "wait", retryAfter }`
  without saying how it knew.
- 2026-09-04 — Four further changes to PLAN.md's sketch, each one settled here
  rather than in the first connector.
  `validateCredentials` returns a reason instead of a boolean: this is a
  bring-your-own-keys product, and "your key is wrong" against "your key has
  no scope" is the whole support channel.
  `search` takes a `SourceQuery` of generated queries and channels, not the
  monitor row, so a connector never reads the Drizzle schema.
  `NextPage` is a three-state union rather than an optional cursor, so a
  cursor exists exactly when a next page does, and a caller cannot read one
  without also reading whether it must wait first.
  `credentialFields` is declared by the connector, so the settings form stays
  generic and a new connector adds no UI case.
- 2026-09-04 — The price is an integer count of micro-dollars, checked at
  registry construction. X's $0.005 is 5000. A connector that writes 0.005 has
  put dollars in a field that counts millionths, and every budget sum after it
  is wrong by a factor of a million. That mistake must not survive to the
  first invoice.
- 2026-09-04 — Acceptance box six is met by the mechanism, not yet by a live
  caller. The registry runs every check at construction, which is process
  start, and `require()` exists for a boot-time list check. Nothing calls it
  yet because no connector and no collector exist. US-005 and US-007 wire it.
- 2026-09-04 — Box seven has one honest caveat, and the document says it. A
  connector needs one folder and one line in `builtInSources`, and no consumer
  needs a case for it. A connector whose posts are *stored* also needs a
  migration, because `posts.source` carries a check constraint.
  `assertSourcesCanBeStored` turns that into a failed boot rather than a
  failed insert inside a scheduled job at night.
- 2026-09-04 — The fake's fixtures are PLAN.md's four worked examples, plus
  one post about sourdough that no monitor should ever match. Reusing them
  means the pipeline tests and the classifier's labelled set talk about the
  same posts from the start. They are written, not captured, and that is
  correct: they are `CandidatePost` values, our own shape. The capture rule
  applies one layer down, to the raw JSON the real connectors parse.
- 2026-09-04 — Fifteen guards were checked by breaking each one and confirming
  a named test turned red. No mutation survived. The list covers the duplicate
  id, the id pattern, the price check, the unknown-id throw, `require`, the
  persistence check, the end-of-page signal, the page size, the cost
  arithmetic, the allowance, the back-off sleep, cursor validation, `since`,
  the credential check in `search`, and the abort signal.
- 2026-09-04 — `unreachableFetch` is in `packages/core/src/testing`. Connector
  tests take it as their runtime's `fetch`, so "no network call" is an
  assertion and not a claim about the code we happened to write. The real
  connectors are unproven until they run against Reddit and X; nothing in this
  suite says the wire format is what we think it is.
