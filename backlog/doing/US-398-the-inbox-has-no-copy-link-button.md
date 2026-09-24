---
id: US-398
title: The inbox has no Copy link button
type: chore
priority: p2
created: 2026-09-24T22:32+08:00
parent:
area:
resolution:
---

## Context

**The owner asked for the button to go.** The reading pane held *Copy link*
beside *Open conversation*, *Save for later* and, since US-396, *Mark as
replied*. It copied the match's own address, which the address bar already
shows: the inbox moves the address to the match a person opens (US-268). So
the button repeated what the browser does, in the row where the actions on a
lead live.

**The address stays.** `/projects/<id>/matches/<matchId>` still opens that
match, and a link somebody pastes still works. Only the button goes.

**The slot stays in the package.** `MatchDetail`'s `actions` prop is public,
and removing it would break a consumer. No application fills it after this.

## Acceptance

- [x] The inbox's reading pane has no *Copy link* button
- [x] A match's address still opens that match, and selecting a match still
      moves the address
- [x] The site's inbox page no longer lists the button
- [x] The package documents no longer name *Copy link* as the slot's content

## Notes

- `apps/web/src/Inbox.tsx` held the button and `copyLink`.
- US-268's address tests stay, and pass.

## Log

- 2026-09-24T22:32+08:00 — Written and built at the owner's request, while
  they looked at the local build of US-396.
