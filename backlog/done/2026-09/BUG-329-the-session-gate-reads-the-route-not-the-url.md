---
id: BUG-329
title: The session gate reads the route, not the URL
type: bug
priority: p1
created: 2026-09-23T06:40+08:00
parent:
area: api
resolution: shipped
---

## Context

The `onRequest` gate in `apps/api/src/auth.ts` decided whether a request
needed a session from the raw URL: any path not starting with `/api/` was
open. The router decodes a path before it matches, so `GET /%61pi/matches`
was open to the gate and was served by the `/api/matches` handler.

Every `/api` route was reachable signed out. Most still failed, because
`sessionUser()` throws when the gate set no user, so the answer was a 500
instead of data. One route read nothing about the user (BUG-330), and a
signed-out visitor read it.

Held in a private advisory, GHSA-gw88-65fj-7pj4, until a release carries the
fix. SECURITY.md.

## Acceptance

- [x] The gate decides by the route that matched, `request.routeOptions.url`.
- [x] A test sends two encoded spellings of every registered `/api` route,
      signed out, and each answers 401.
- [x] The full suite passes.

## Notes

- With no route matched, no handler runs, so the raw path still decides
  between a 401 and the web page, as before.
- `auth.test.ts`, *refuses them however the path is spelled*.

## Log

- 2026-09-23T06:40+08:00 — Found in a review of the open repository, and
  reproduced: all 57 `/api` routes reached their handler through
  `/%61pi/...` with no session.
- 2026-09-23T06:52+08:00 — Fixed. The new test failed on the old gate at the first route it
  tried (`PUT /%61pi/onboarding`) and passes on the new one. Full suite:
  132 files, 2,324 tests. Not run against a deployed instance.
