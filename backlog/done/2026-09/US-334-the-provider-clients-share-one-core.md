---
id: US-334
issue: 82
title: The provider clients share one core
type: chore
priority: p2
created: 2026-09-23T06:46+08:00
parent:
area: sources
resolution: shipped
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

- [x] `packages/engine` holds one provider error with one list of kinds, and
      every client throws it.
- [x] One helper does the fetch, the lenient parse and the `Retry-After`
      read, and every client uses it.
- [x] Each connector's captured-fixture tests pass unchanged. An expected
      value that moves is a bug in the change, not in the test.
- [x] BUG-324's shared `Retry-After` function is this helper's, and the Log
      says whether BUG-324 closes with this ticket.

## Notes

- `packages/engine/src/sources/providers/*/client.ts`.
- Nothing in `packages/pipeline` or `apps/api` names a client's error class;
  connectors turn errors into outcomes, so the change stays inside the engine.
- `docs/sources.md` describes how a provider is added; update it with the
  shared core.

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
- 2026-09-23T07:11+08:00 — Shipped. `providers/core.ts` holds `ProviderError`, `readAnswer`
  and `retryAfterDate`; each client's error is a one-line subclass, so the
  23 `instanceof` checks in the connectors did not change. Five clients lost
  171 lines and gained 32. Bright Data reads no `Retry-After`: its waits come
  from the snapshot flow, so it keeps its own `retryAt(seconds)`.

  One behaviour moved on purpose: `Retry-After: 0` now takes the fallback,
  where ScrapeCreators, Apify and SocialData waited zero seconds. A zero wait
  books a resume poll for now, which can spin. No test covered `Retry-After`
  before; `core.test.ts` has eight cases now.

  The captured-fixture tests passed unchanged: 36 engine files, 756 tests.
  Full suite: 133 files, 2,331 tests. **BUG-324 does not close here**: three
  of its four boxes are this helper's; the fourth, that a monitor's other
  platforms keep polling while one waits, is pipeline work.
