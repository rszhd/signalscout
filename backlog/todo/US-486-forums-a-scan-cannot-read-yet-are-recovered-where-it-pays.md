---
id: US-486
title: Forums a scan cannot read yet are recovered where it pays
type: spike
priority: p3
created: 2026-11-01T03:26+08:00
parent: US-473
area: pipeline
---

## Context

A survey of 287 forums, 6 for each of 52 niches, named by the model the way
a scan names them (US-473), found on 2026-11-01:

- 191 readable through a feed (XenForo 2 130, vBulletin 4 18, a feed with
  no known program 16, Discourse 7, phpBB 8, others), 158 of them with a
  thread less than 24 hours old; 9 more through Invision's stream (US-485).
- 57 with no known program and no feed. Their home pages, read again
  through the browser (60 units): the forum is elsewhere on the site 5; a
  popular program with no parser 8; a bot check, a login or members only 11;
  dead or no longer a forum 5; no mark of any known program 28.
- 13 whose feed is off or empty; 15 lost to faults (browser time-outs 4,
  proxy or certificate errors 5, Bright Data 5xx 4, an empty page both ways
  2); 2 Invision boards with no stream (a wrong address, no `/discover/`).

The owner decided on 2026-11-01: release what is built, find users first in
the niches with the most readable forums, and recover the rest later. Six
niches had all 6 forums readable (aquariums, RVs and camping, guitars,
drones, smart home, dogs); real estate, fishing, running and gardening had
1 or 2. This ticket holds what would recover more, cheapest first, for when
it pays.

## Acceptance

- [ ] Vanilla (boards.ie, digitalspy, moneysavingexpert) and UBB.threads
      (24hourcampfire, texasfishingforum): a probe says whether each has a
      feed of new threads; if so, a home-page check names it, with no page
      parser.
- [ ] A home page that names no program: a probe of advrider (`/f`),
      thinksteroids (`/community/`) and eham (`/forum`) says whether the
      page its "Forum" link names is one a parser reads. Following that link
      changes how a scan finds forums: the owner's word first.
- [ ] The 15 faults are read again with BUG-484 in place, and the 9
      Invision boards through the scan's own forum check.
- [ ] Each step's gain, in forums and in the niches they belong to, is in
      the Log.

## Notes

- Per-forum state: `forum-survey/forum-status-2026-11-01.csv` beside the
  repositories. No-feed home pages and their sort:
  `forum-survey/nofeed-homes/` (`results.json`, one `.html` each).
- Not worth a parser now: Khoros (tripadvisor; toolsinaction is an
  archive) and Flarum (one small board). The 11 blocked sites stay blocked;
  no parser is written for one site's own software (owner, 2026-10-30).
- Each Invision stream page costs 2 units because each call starts its own
  browser (US-485 Log); reading several pages in one call would halve it.
- A probe is a few paid page reads, about one unit each; say the count
  before running one.

## Log
