---
id: BUG-526
title: A browser read waits for the page to be parsed
type: bug
priority: p1
created: 2026-11-05T18:10+08:00
parent:
area: sources
resolution:
---

## Context

A browser read waits for the first load event, and then for a bot check to
pass. When a check passes, the browser loads the real page, but the read
did not wait for that page. It could catch the page still arriving: Etsy's
came back cut off inside its <head>, with no body and no words, and the
application took the site for unreadable.

The read now asks `document.readyState` and waits while it is `loading`,
before it reads and after each wait for a check. A page still loading after
15 seconds is read as it stands.

## Acceptance

- [x] A read waits while `document.readyState` is `loading`.
- [x] A page that never finishes parsing is still read after the wait.

## Log

- 2026-11-05T18:10+08:00: An Etsy shop address read through Browser Use on a residential
  proxy came back as 9,286 characters of <head> and no body. With this
  change, the same address read whole on the first try: 18,798 characters
  of text in 12 seconds.
