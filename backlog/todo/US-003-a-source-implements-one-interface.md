---
id: US-003
title: A source implements one interface
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
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

- [ ] `SocialSource` is defined in `packages/core/sources`, with no import of
      Fastify or React
- [ ] The interface covers: identity, credential validation, search with a
      cursor, units consumed, and the per-unit price
- [ ] Rate limiting and back-off are the connector's responsibility, and the
      interface makes that possible without the caller knowing the mechanism
- [ ] A `fake` source implements the interface and returns fixture posts with
      no network call
- [ ] The fake can be told to exhaust its rate limit and to return a partial
      page, so callers can be tested against both
- [ ] A registry maps a source id to an implementation, and an unknown id
      fails loudly at startup rather than at poll time
- [ ] Adding a connector requires touching the registry and one new folder,
      and nothing else — a test or a document demonstrates this

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- Blocks [US-005](US-005-reddit-returns-candidate-posts.md) and
  [US-006](US-006-x-returns-candidate-posts-and-says-what-it-spent.md).
- PLAN.md, *Architecture*, for the original sketch.
- The backlog's ordering precedent puts this early on purpose: a ticket that
  settles shared vocabulary goes first.

## Log

- 2026-09-04 — Written from PLAN.md. The three additions to PLAN.md's sketch
  are proposals; the work settles them.
