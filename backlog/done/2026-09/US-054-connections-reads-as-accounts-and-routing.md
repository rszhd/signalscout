---
id: US-054
title: Connections reads as accounts and routing
type: chore
priority: p2
created: 2026-09-07T02:15+08:00
parent:
area: web
resolution: shipped
---

## Context

Connections puts two different jobs on one page: storing provider credentials
and choosing which connected provider fetches a platform. The behavior is
correct, but the page presents both as long bordered lists with similar rows.
Provider identity, covered platforms, credential origin, readiness and the
disclosure action compete for attention in every row.

The page should read first as a small set of provider accounts, then as routing
that only needs attention when more than one account can fetch a platform. The
credential rules and native disclosure behavior do not change.

## Acceptance

- [x] Provider accounts read as separate, scannable cards with a clear status
- [x] Opening an account reveals one contained credential editor and its actions
- [x] Platform routing is visually secondary and makes the available choice clear
- [x] Stored, environment and missing credential origins remain visible
- [x] Responses remain visible after a provider disclosure closes
- [x] Desktop and phone layouts have no horizontal overflow
- [x] Existing Connections interaction tests, typecheck and production build pass

## Notes

- Keep the selection rule in `decideProvider`; this ticket changes no API or
  provider behavior.
- Keep native `details`, password inputs and radio buttons. These semantics are
  already covered by the screen tests.

## Log

- 2026-09-07T02:15+08:00 — Opened at the owner's request after a Chrome capture
  showed the current three-account and unresolved-routing state.
- 2026-09-07T02:22+08:00 — Shipped separate account cards, a contained credential
  editor, compact status and platform badges, and provider-choice cards in a
  secondary routing section. Chrome rendered the full state at 1440 and 375
  pixels with a 375-pixel document width and no card overflow. Connections
  tests passed 16/16, the full web suite passed 135/135, and web typecheck and
  production build passed.
