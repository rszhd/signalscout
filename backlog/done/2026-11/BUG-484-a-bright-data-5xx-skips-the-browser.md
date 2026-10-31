---
id: BUG-484
title: A Bright Data 5xx answer skips the browser
type: bug
priority: p2
created: 2026-11-01T02:27+08:00
parent: US-473
area: pipeline
resolution: shipped
---

## Context

`fetchThroughUnlocker` throws an `UnlockerError` of kind `provider` when
Bright Data answers 500, 502 or 504. `openForumFetcher` catches no thrown
error, so the page is not read through the browser, and the forum
connector's `search` throws it on (it turns only `rateLimit` into a wait).
With Bright Data first, the browser is never tried. With the browser first
(the BuyerFinder default), a browser failure followed by a Bright Data 5xx
fails the whole call.

In the forum recheck on 2026-11-01, 9 of 19 forums failed this way in one
cluster (bbcboards, bikeforums, forums.qth, helpfulgardener, weightweenies,
ugbodybuilding, malfreemaps, coffeeforum, texasbbqforum). At 3 lanes in
place of 10, the retry read 4 of the 9 through Bright Data or the browser,
and 2 still got a 500 (ugbodybuilding, webhostingforum). The owner agreed to
this ticket.

## Acceptance

- [x] With the browser set and Bright Data first, a Bright Data 5xx is read
      through the browser.
- [x] With the browser first, a browser failure followed by a Bright Data
      5xx loses that page only; the call goes on and returns its other pages.
- [x] Without the browser, a Bright Data 5xx is a refusal of that page, not
      a thrown error.
- [x] A 401, 402, 403, 400 or 429 is still thrown as today.
- [x] Tests show each case.

## Notes

`packages/engine/src/sources/providers/brightdata/unlocker.ts`
(`fetchThroughUnlocker`), `forum.ts` (`openForumFetcher`, `search`).
Recheck output: `forum-survey/feed-survey/recheck3.log` and `recheck4.log`
beside the repositories.

## Log
- 2026-11-01T03:09+08:00 — The forum page fetcher reads Bright Data through
  `unlockerPage`, which turns a 5xx into a refusal of that page: the browser
  is tried after it, and without a browser the poll goes on to its next
  page. Other answers still throw (a 404 too: the ticket names 5xx only).
  The credential check calls Bright Data directly, so an outage there is not
  read as a bad key. Six tests; with the change undone, the four behaviour
  tests fail. 2,782 tests pass. Not seen live: a 5xx cannot be asked for.
