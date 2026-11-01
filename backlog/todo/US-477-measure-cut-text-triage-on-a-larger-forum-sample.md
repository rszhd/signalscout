---
id: US-477
title: Measure cut-text triage on a larger forum sample
type: chore
priority: p2
created: 2026-10-31T17:09+08:00
parent: US-476
area: pipeline
resolution:
---

## Context

US-476 lets the pre-filter and triage judge a forum post on the title and
the cut text a feed gives, and reads the thread's page only for a post that
passes. Its measurement on 2026-10-31 used 96 stored forum posts and only
two matches: on the cut text 52 posts passed against 57 on the full text,
none of the 7 lost was a match, and both matches passed. The owner accepted
the difference for now and asked for the comparison again on a larger
sample, later.

## Acceptance

- [ ] At least 500 forum posts with their full text, from at least 10
      forums of at least 3 programs, and at least 20 matches among them.
      Where they come from (production, or a local monitor polled for
      several days) is written in the Log.
- [ ] Each judged by the embedding stage and triage on the full text and on
      the cut text the forum's own feed gives (or its first 330 characters
      where that is not kept), the same way as US-476's measurement
      (`forum-survey/partial-triage.mjs`).
- [ ] The classifier scores the posts each way passes, so the leads lost and
      gained are counted, not only the posts.
- [ ] Triage's own noise is measured on the same run: posts whose two texts
      are the same, asked twice.
- [ ] The Log gives the counts, every lost match with its title and scores,
      and a recommendation: keep the cut text, lengthen it, or read pages
      for `maybe` too. The owner decides.

## Notes

The classifier runs on the Claude bridge: say the call count before the run.

## Log
