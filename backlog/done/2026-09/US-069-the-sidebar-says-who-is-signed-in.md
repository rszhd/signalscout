---
id: US-069
title: The sidebar says who is signed in
type: feature
priority: p2
created: 2026-09-08T11:45+08:00
parent: US-066
area:
resolution: done
---

## Context

The sidebar carries a hardcoded `Self-hosted` pill. It was written before there
were accounts and it was true then: one instance, one person, nobody to be.

US-066 made it false. An instance with `AUTH_SIGNUP=open` is not self-hosted,
and the label says so on every page anyway. It also occupies the one place a
signed-in person looks to find out **which account they are using** — which
stopped being obvious the moment a second one could exist. The owner found this
the hard way, spending a round trip working out which of two accounts owned a
stored provider key.

So the pill goes and the account takes its place. The reassurance the pill
carried belongs on the marketing page, not on every screen of a tool somebody
has already installed.

`/api/auth-status` is the route that answers it, because the shell already asks
that route once on load and a second request for one string would be a second
request. It stays open to a signed-out visitor — it has to be, the login screen
asks it — so it answers `account: null` unless the request carries a session.
Nothing about a person leaves this route without their own cookie.

## Acceptance

- [x] The sidebar shows the signed-in account's name and email
- [x] The `Self-hosted` pill is gone
- [x] `/api/auth-status` returns the account only to a request that carries its
      session, and `null` otherwise, asserted by a test
- [x] The login screen still works, which is the same route answering with no
      account

## Notes

- One extra field on a route the shell already calls. No new request.

## Log

- 2026-09-08T11:45+08:00 — Written after the owner asked what condition shows
  the pill. The answer was "none, it is hardcoded", which is the bug.
- 2026-09-08T11:50+08:00 — Closed. The email is shown in full and allowed to
  wrap rather than being cut with an ellipsis: it is the part that tells two
  accounts apart, and a truncated one tells them apart badly. `.local-pill` is
  deleted rather than left behind — no markup used it any more.
- 2026-09-08T11:52+08:00 — The route's own case is the one worth keeping. It is
  open by necessity, so it answers with an account only to a request carrying
  that account's cookie: a stranger who finds the port learns whether the
  instance is set up and nothing about who set it up. 1,414 tests pass.
