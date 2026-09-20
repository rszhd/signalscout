---
id: US-268
title: An inbox item has an address
type: feature
priority: p2
created: 2026-09-20T09:10+08:00
parent:
area: web
resolution:
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

- [ ] `GET /api/matches/:id` returns one match, scoped to the owner; a test
      proves a stranger's id answers 404.
- [ ] `route.ts` holds the pattern and the builder; no screen writes the
      address as a string.
- [ ] Opening the address shows that item selected even when it is on a
      later page, under a filter that hides it, or dismissed; a test covers
      each.
- [ ] Selecting an item updates the address without reloading the list.
- [ ] The item panel has a copy-link control.

## Notes

- `packages/pipeline/src/index.ts:237` — `readMatch`.
- `apps/web/src/route.ts:27` — `routes.inbox`; `:48` `paths.inbox`.
- `apps/api/src/matches.ts:169` — the list route to sit beside.

## Log

- 2026-09-20T09:10+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
