---
id: US-281
title: The inbox gives the work the screen
type: chore
priority: p3
created: 2026-09-20T19:40+08:00
parent:
area: web
resolution: shipped
---

## Context

The inbox is the densest working screen in the product. Its shared header
spent a row on a title and a sentence — "Inbox", "Find your next
conversation." — while the match list and the reader competed for what was
left. The navigation already names the screen, and since US-265 the
monitoring bar at the top says what the screen is doing; a visible title
repeats the first and pushes the second down.

The hosted application did this as US-182, and the owner asked for it here.
The header goes; a hidden `h1` keeps the page's accessible heading, which is
what a screen reader lands on. Every other screen keeps the shared header.

The header's one action, *New monitor*, goes with it. The design document
already counts that action in three places — the inbox header, the monitor
list header and every project card — and two remain. The inbox's empty state
still offers *Create a monitor* where there is none.

## Acceptance

- [x] The inbox has no visible title bar at desktop or phone widths. (By the
      code: the `<header>` is gone and so are the phone rules that shaped it.
      No browser has rendered it — the extension is not connected.)
- [x] A visually hidden `h1` says "Inbox".
- [x] The rules that shaped the inbox's header are gone from `index.css`, and
      the shared `.topbar` is untouched for every other screen.
- [x] The tests that asserted the inbox by its `.topbar h1` assert the hidden
      heading instead.
- [x] `docs/design.md` counts *New monitor* in two places, not three.

## Notes

- `apps/web/src/Inbox.tsx:757–767`, `index.css:2200` and `:2815–2845`,
  `App.test.tsx` (three assertions from US-280), `docs/design.md:32`.
- Hosted: US-182.

## Log

- 2026-09-20T19:40+08:00 — Asked for by the owner, right after US-280.
- 2026-09-20T19:50+08:00 — Shipped. The header and its one action are gone;
  a `visually-hidden` `h1` says "Inbox". The base stylesheet lost the
  inbox's gutter override and the four phone-width rules that fitted the
  title and the action on one row. The three App assertions from US-280 read
  the page's `h1` rather than `.topbar h1`, and still prove the screen: the
  sidebar has no `h1`, so the first one is the page's. 350 web tests pass.
