---
id: BUG-480
title: Completing partial posts starts one browser a page
type: bug
priority: p2
created: 2026-11-01T00:48+08:00
parent: US-476
area: pipeline
resolution:
---

## Context

US-476's complete step calls `completePost` once for each partial post, and
the forum connector opens a page fetcher for each call. With the cloud
browser first, each fetcher starts its own browser: 20 pages cost 40 units
(a page and a browser each) where one browser would cost 21, and each start
adds its wait. Seen on a local rockler.com scan on 2026-10-31.

## Acceptance

- [x] A connector completes several partial posts in one call that shares
      one page fetcher, so one browser at most for the call, stopped when it
      ends.
- [x] The complete step makes one such call per source in a job, and records
      each post's units and result as before, with the same 20-page cap.
- [x] A test shows 3 partial posts read through one browser start.

## Log
- 2026-11-01T00:53+08:00 — Built by DeepSeek Flash through opencode from a
  brief, reviewed and checked here. `completePost` is now `completePosts`,
  an async iterable over one fetcher, closed when the iteration ends; the
  complete step groups the first 20 partial posts by source and makes one
  call per source. Never released, so the old method is gone. 71 tests in
  the connector and the step pass. Not yet run live.
