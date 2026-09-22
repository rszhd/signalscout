---
id: BUG-330
title: A cost test and a draft read only their own account
type: bug
priority: p1
created: 2026-09-23T06:40+08:00
parent:
area: api
resolution: shipped
---

## Context

Two routes loaded a record by id with no owner check. `GET
/api/monitors/estimates/:id` read a cost test with `readEstimate(db, id)`
and never read the session user. `POST /api/matches/:id/draft` read the
match through `draftContext(db, matchId)`, which joins to the monitor and
the post by id alone.

So on an instance with more than one account, anyone signed in who knew an
id read another account's cost test — its queries, platforms and costs — and
drafted on another account's match, with that account's product, buyer and
problem in the prompt and the call counted against that account's cap. With
BUG-329, a signed-out visitor read the cost test too.

Held in a private advisory, GHSA-v4g2-xcgx-r5gp, until a release carries the
fix. SECURITY.md.

## Acceptance

- [x] The cost test routes read through `readOwnedEstimate`, which answers
      only for the account that started the test.
- [x] `draftContext` takes the user id and filters on the monitor's owner.
- [x] A test per route shows another account gets 404, with a control that
      the owner still reaches their own record.
- [x] The changelog says what a consumer of `@signalscout/pipeline` must
      change.

## Notes

- `readEstimate` stays instance-wide: the worker runs every account's cost
  tests and reads them by id.
- `leads` and `onboarding` have no cross-account test yet; US-336 adds one
  per route.
- The hosted application consumes `draftContext`, if it does, through the
  package, and must pass the user when it upgrades.

## Log

- 2026-09-23T06:40+08:00 — Found in a review of the open repository, and
  reproduced: a second account got 402 (the owner's budget) on a draft and
  200 with the owner's query on a cost test; a signed-out request through
  `/%61pi/` got the cost test too.
- 2026-09-23T06:56+08:00 — Fixed. Both new tests failed first (402 and 200 where 404 was
  expected) and pass now; the owner's control cases pass in both. Full
  suite: 132 files, 2,327 tests. Not run against a deployed instance.
