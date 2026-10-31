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
- 2026-10-31T17:03+08:00 — Measured on the 96 forum posts stored in
  BuyerFinder's local database (four scans of 2026-10-30 and 31), each
  judged twice by the embedding stage (threshold 0.15) and triage (Jev):
  on the stored text, and on its first 330 characters plus "...", the
  length XenForo 2's feed gave. 192 triage calls, about $0.008. 53 posts are
  longer than 330 characters. On the full text 57 posts pass both stages;
  on the cut text 52: 7 lost, 2 gained. Of the 43 posts whose cut text is
  their whole text, triage kept 2 differently on the second ask, so about 5%
  of a difference is triage's own noise. None of the 7 lost posts was a
  match; all but one had a `no` both times and fell under the confidence
  floor on one side. Both forum matches so far (BladeForums, scores 90 and
  52) pass on the cut text with `yes`. On the third vortexoptics.com scan,
  24 of 51 posts pass on the cut text: 24 thread pages instead of 79. Two
  matches are a small sample; the owner decides whether this difference is
  accepted. Script and results: `forum-survey/partial-triage.jsonl`.
- 2026-10-31T17:09+08:00 — The owner accepted the difference for now, and
  asked for the comparison again on a larger sample later: US-477.

