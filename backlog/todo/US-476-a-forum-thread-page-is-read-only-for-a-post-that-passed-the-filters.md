---
id: US-476
title: A forum thread page is read only for a post that passed the filters
type: feature
priority: p2
created: 2026-10-31T15:30+08:00
parent: US-473
area: pipeline
resolution:
---

## Context

US-473 reads a whole forum through its newest-threads feed. Where the
program's feed holds the first post (phpBB, vBulletin 5, MyBB, bbPress) the
items are the posts. Where it cuts the text (XenForo 1 and 2, vBulletin 3/4,
SMF) the connector reads each new thread's page before the pipeline sees
the post, at one Bright Data request ($0.0015) a page. XenForo is most of
the forums the survey could read (97 of 144).

A local BuyerFinder scan on 2026-10-31 (vortexoptics.com, US-474's Log) read
79 thread pages from four forums. 51 posts came of them; the embedding stage
and triage kept 28; the classifier matched none. A whole forum's newest
threads are mostly not buyers, so most pages bought are posts the filters
drop.

**The owner chose to decide on the title and the cut text first, and read
the page only for a post that passes.** The feed item already holds the
title, the first few hundred characters and the thread's address.

## Acceptance

- [ ] A cut feed's new items become posts at once, with the feed's title and
      text, marked as partial; the connector opens no thread page in the
      poll. Their id is the one a thread page gives (XenForo `.<id>/`,
      vBulletin `t=`, SMF `topic=`).
- [ ] The keyword, embedding and triage stages judge a partial post on its
      partial text.
- [ ] A partial post that passes them is completed before the classifier:
      the connector reads its thread page once, and the post takes the
      page's text and start time. The page's request is billed to the
      monitor and counts against its cap.
- [ ] A post whose page cannot be read (refused, no parser) is classified on
      its partial text, and the reason is logged.
- [ ] A post whose page shows it started before the poll's `since` (XenForo
      2's feed orders threads by their last reply) is dropped there, as
      today.
- [ ] Before shipping: on stored forum posts, triage on the first 330
      characters keeps the same posts as triage on the full text, or the
      difference is written in the Log and the owner accepts it.
- [ ] Tests on a real Postgres with captured feeds and pages; no test fetches.

## Notes

A full-text feed needs none of this: its items are complete posts already.

The settings that cap thread pages a poll (`threadsPerSection`, BuyerFinder's
`LOOKOUT_FORUM_THREAD_PAGES`) would cap completions instead.

Changing what reaches triage is a scoring change: the
`measure-scoring-change` skill applies before it ships.

## Log
