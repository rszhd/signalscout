---
id: BUG-479
title: XenForo 2 threads in VerticalScope's theme are not read
type: bug
priority: p2
created: 2026-11-01T00:48+08:00
parent: US-469
area: sources
resolution:
---

## Context

A local rockler.com scan on 2026-10-31 read LumberJocks through the cloud
browser. All 12 thread pages came back, and the XenForo 2 parser read none.
LumberJocks runs VerticalScope's "California" theme: the page is XenForo 2
(`<html id="XF">`), but the thread's title is `h1.MessageCard__thread-title`,
the first post is an `<article ... qid="post-text">` whose text is in
`bbWrapper`, and its time is the first `<time datetime="<ISO>"
qid="post-date-time">`, with no `data-timestamp`. VerticalScope runs many of
the forums the survey found (Woodworking Talk too).

## Acceptance

- [ ] `xenforo2.readThread` reads `xenforo2-california-thread.html`: id
      367057, the title, the first post's text, and its time from the ISO
      `datetime`, not approximate.
- [ ] The plain XenForo 2 thread reads as before.
- [ ] No test fetches.

## Notes

The capture is `xenforo2-california-thread.html` (4c1e18a). The first post
appears twice in it; the first copy is the one read.

## Log
