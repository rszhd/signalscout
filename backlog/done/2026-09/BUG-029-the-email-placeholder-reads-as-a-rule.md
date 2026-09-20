---
id: BUG-029
title: The email placeholder reads as a rule
type: bug
priority: p3
created: 2026-09-20T08:56+08:00
parent:
area: web
resolution: shipped
---

## Context

The sign-in form's email field shows `you@company.com` as its placeholder.
People read it as a requirement and think a Gmail address will be refused. It
will not: the form accepts any address and nothing on the server checks the
domain.

A placeholder is an example of the shape, not a rule about the value. A
person who cannot register with the address they have does not ask; they
leave. `example.com` is reserved for exactly this use and names no kind of
person.

The hosted application fixed this as BUG-027.

## Acceptance

- [x] The placeholder is `you@example.com`.
- [x] No other placeholder in `apps/web/src` names a kind of address.

## Notes

- `apps/web/src/Login.tsx:289`.

## Log

- 2026-09-20T08:56+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
- 2026-09-20T09:06+08:00 — Shipped. The other two placeholders in
  `apps/web/src` are example problem statements, not addresses. The login
  test pins the placeholder. 13 login tests pass.
