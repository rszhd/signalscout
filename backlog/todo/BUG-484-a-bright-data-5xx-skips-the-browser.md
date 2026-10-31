---
id: BUG-484
title: A Bright Data 5xx answer skips the browser
type: bug
priority: p2
created: 2026-11-01T02:27+08:00
parent: US-473
area: pipeline
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

- [ ] With the browser set and Bright Data first, a Bright Data 5xx is read
      through the browser.
- [ ] With the browser first, a browser failure followed by a Bright Data
      5xx loses that page only; the call goes on and returns its other pages.
- [ ] Without the browser, a Bright Data 5xx is a refusal of that page, not
      a thrown error.
- [ ] A 401, 402, 403, 400 or 429 is still thrown as today.
- [ ] Tests show each case.

## Notes

`packages/engine/src/sources/providers/brightdata/unlocker.ts`
(`fetchThroughUnlocker`), `forum.ts` (`openForumFetcher`, `search`).
Recheck output: `forum-survey/feed-survey/recheck3.log` and `recheck4.log`
beside the repositories.

## Log
