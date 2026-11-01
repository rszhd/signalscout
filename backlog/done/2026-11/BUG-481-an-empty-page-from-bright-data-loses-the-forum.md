---
id: BUG-481
title: An empty page from Bright Data loses the forum
type: bug
priority: p1
created: 2026-11-01T01:47+08:00
parent: US-473
area: pipeline
resolution: shipped
---

## Context

Bright Data at times answers a forum page with a 200 and an empty body, or
with `<html><head></head><body></body></html>`. The forum fetcher takes that
as the page, so a scan's forum check finds no program and no feed and drops
a forum it can read. The 287-forum feed survey on 2026-11-01 lost five
XenForo forums this way (audiokarma, fishlore, gardenstew, zerotohundred,
thefashionspot) and three feeds (audiokarma, photrio, woodnet); each came
back whole when asked again. The owner decided: an empty page is read
again through the cloud browser.

## Acceptance

- [x] An empty page, or one whose body holds nothing, is a refusal for both
      Bright Data and the browser.
- [x] With the browser set, an empty page from Bright Data is read through
      the browser; one from the browser first is read through Bright Data.
- [x] Tests show both, and that a real page with little text is not a
      refusal.

## Notes

`refusalIn` in `packages/engine/src/sources/providers/brightdata/unlocker.ts`
serves both readers (`browseruse/cdp.ts`). Survey results:
`forum-survey/feed-survey/feed-survey.csv` beside the repositories.

## Log
- 2026-11-01T01:59+08:00 — `refusalIn`, which both readers use, calls an
  empty body or an empty `<html><head></head><body></body></html>` a refusal.
  So Bright Data's empty page goes to the browser; the browser polls an empty
  page like a challenge and then refuses it, and the fetcher's existing rule
  sends that to Bright Data (the challenge test covers the path). Without a
  browser, the empty page is a refusal that bills nothing. 2,757 tests pass.
  Not seen live: an empty answer cannot be asked for. In the survey recheck
  pitmaster.amazingribs.com's feed came back empty through both readers and is
  now reported as "the site answered with an empty page".
