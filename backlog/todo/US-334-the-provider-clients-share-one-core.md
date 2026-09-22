---
id: US-334
title: The provider clients share one core
type: chore
priority: p2
created: 2026-09-23T06:46+08:00
parent:
area: sources
resolution:
---

## Context

Five provider clients — Apify, Bright Data, ScrapeCreators, SocialCrawl and
SocialData, 2,224 lines together — each carry the same four pieces written
separately: an error class, a `call()` that fetches and parses JSON leniently,
a `fail()` that maps an HTTP status to a kind, and a `retryAt()`. The kinds
are nearly one list: `credentials`, `input`, `rateLimit`, `provider`,
with Bright Data's `account` and SocialData's `balance` as the only extras.

Five copies of one rule drift. BUG-324 is the drift already happening: four
`Retry-After` parsers, each with different rules and none with a limit.

## Acceptance

- [ ] `packages/engine` holds one provider error with one list of kinds, and
      every client throws it.
- [ ] One helper does the fetch, the lenient parse and the `Retry-After`
      read, and every client uses it.
- [ ] Each connector's captured-fixture tests pass unchanged. An expected
      value that moves is a bug in the change, not in the test.
- [ ] BUG-324's shared `Retry-After` function is this helper's, and the Log
      says whether BUG-324 closes with this ticket.

## Notes

- `packages/engine/src/sources/providers/*/client.ts`.
- Nothing in `packages/pipeline` or `apps/api` names a client's error class;
  connectors turn errors into outcomes, so the change stays inside the engine.
- `docs/sources.md` describes how a provider is added; update it with the
  shared core.

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
