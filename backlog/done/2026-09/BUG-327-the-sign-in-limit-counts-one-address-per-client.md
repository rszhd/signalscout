---
id: BUG-327
title: The sign-in limit counts one address per client
type: bug
priority: p1
created: 2026-09-23T06:15+08:00
parent:
area: api
resolution: shipped
---

## Context

The API relied on Better Auth's rate limiter and set none of its options.
Better Auth took the client's address from `X-Forwarded-For`: a single value
as written, and for several values with no `trustedProxies`, no address at
all. With no address, every request for a path shared one bucket, three
sign-ins in ten seconds. And the limiter was on only when `NODE_ENV` was
production.

Behind Traefik, a client that sent its own `X-Forwarded-For` landed in the
shared bucket and could keep everyone else in it from signing in. With no
proxy, a client that sent a new address each time got a new allowance each
time.

Held in a private advisory, GHSA-vwc6-g6xx-w7cv, until a release carries the
fix. SECURITY.md.

## Acceptance

- [x] The API decides the client's address — Fastify's `request.ip` under a
      new `TRUST_PROXY` setting — and hands Better Auth only that, in a
      header it sets and a client cannot.
- [x] `TRUST_PROXY` unset trusts loopback and the private networks, so a
      proxy in front works with no setting and a direct client from the
      internet cannot name itself. `off` and an explicit list override it.
- [x] The limiter is on by stating it, not by `NODE_ENV`.
- [x] Tests: a fourth try is refused; a direct client inventing addresses is
      still refused; two clients behind one proxy keep separate allowances,
      and an address a client puts in front of the proxy's is ignored.
- [x] `.env.example`, `docker-compose.yml` and `docs/self-hosting.md`
      name the setting.

## Notes

- **The hosted application does not get this from the packages.** The fix is
  in `apps/api`, and the hosted `apps/` is a fork; the same holds for the
  gate in BUG-329 and the routes in BUG-330. Each needs its own port there.
- `buildServer` takes `authRateLimit` and `createAuth` takes `rateLimit`,
  both on by default. Only tests that sign in faster than a person, about
  something else, turn it off. No setting reaches either.
- The limiter's memory is Better Auth's default: one process, lost on
  restart. That is enough for one instance and is not a distributed limit.

## Log

- 2026-09-23T06:15+08:00 — Found in a review of the open repository, from
  Better Auth 1.7.3's source (`getIP`, `getIPFromHeader`, the rate
  limiter). Not reproduced against a running instance.
- 2026-09-23T07:06+08:00 — Fixed. The three limiter tests failed first (401 where 429 was
  expected: the limiter was off under `NODE_ENV=test`). Turning it on made
  eighteen older auth tests meet it; they now build without it, as the
  `session` seam lets a test skip the login. Full suite: 132 files, 2,335
  tests. Not run against a deployed instance behind Traefik.
