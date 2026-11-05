---
id: BUG-525
title: A browser read waits out DataDome's check
type: bug
priority: p1
created: 2026-11-05T16:43+08:00
parent:
area: sources
resolution:
---

## Context

A browser read waits up to 25 seconds for a bot check to pass, but only for
a check it recognises. DataDome's check was not one of them. Its page has
no words, a title naming the site and a frame from captcha-delivery.com, so
the read took it at once and gave up. A real browser passes the check within
seconds when it waits.

## Acceptance

- [x] `challengeIn` recognises DataDome's frame, so the browser waits it out.
- [x] A real page that only loads DataDome's script is still a page.

## Log

- 2026-11-05T16:43+08:00: An application read two Etsy shops through Browser Use on its own
  residential proxy, images off. Both returned DataDome's 1.5 KB page with
  the text "etsy.com". The same read with a fixed 30-second wait got the shop.
  With this change, the same two reads got 19,088 and 22,156 characters of
  the shops, in about 10 seconds each.
