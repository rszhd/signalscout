---
id: US-268
title: An inbox item has an address
type: feature
priority: p2
created: 2026-09-20T09:10+08:00
parent:
area: web
resolution: shipped
---

## Context

An item in the inbox can be read and not referred to. The selection is local
state, so the address stays `/projects/<id>` whichever item is open.
Somebody wanting to point a colleague at a lead has nothing to send.

`/projects/<projectId>/matches/<matchId>` is that address, and the inbox
renders on both routes.

A half-working address would be worse than none. The list resolves its
selection from the page it has loaded and falls back to the first row, so an
id alone would open a different item whenever the match is on a later page,
under another filter, or already dismissed, silently and only for the
recipient. So the screen fetches the item when the loaded page does not hold
it. `readMatch` is exported by the package since 0.11.0 (US-234) and nothing
here calls it.

The hosted application built this as US-235.

## Acceptance

- [x] `GET /api/matches/:id` returns one match, scoped to the owner; a test
      proves a stranger's id answers 404.
- [x] `route.ts` holds the pattern and the builder; no screen writes the
      address as a string.
- [x] Opening the address shows that item selected even when it is on a
      later page, under a filter that hides it, or dismissed; a test covers
      each.
- [x] Selecting an item updates the address without reloading the list.
- [x] The item panel has a copy-link control.

## Notes

- `packages/pipeline/src/index.ts:237` — `readMatch`.
- `apps/web/src/route.ts:27` — `routes.inbox`; `:48` `paths.inbox`.
- `apps/api/src/matches.ts:169` — the list route to sit beside.

## Log

- 2026-09-20T09:10+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
- 2026-09-20T12:50+08:00 — Shipped. `GET /api/matches/:id` reads through
  the package's `readMatch`, so a stranger's id, a hidden one and one that
  never existed answer the same 404. `routes.inboxMatch` and
  `paths.inboxMatch` are the address; `App.tsx` renders the inbox on both
  patterns and hands it the id. The inbox asserts the selection from the
  address after every load, fetches the item only when the loaded page
  does not hold it, shows it even when the filters empty the list, and
  says so on a 404. A click replaces the address so Back leaves the inbox.
  *Copy link* writes the address to the clipboard. 3 route cases and 6
  inbox cases; three mutations (the top row winning over the address, the
  item never fetched) went red under them, and one did not: `replace`
  against `push` on the click has no test, because the harness does not
  expose the history. 764 web and API tests pass. No browser has rendered
  the link.
