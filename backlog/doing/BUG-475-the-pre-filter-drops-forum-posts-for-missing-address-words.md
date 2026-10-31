---
id: BUG-475
title: The pre-filter drops forum posts for missing address words
type: bug
priority: p1
created: 2026-10-31T14:30+08:00
parent: US-470
area: pipeline
resolution:
---

## Context

The keyword stage keeps a post that shares a word with its platform's
queries (US-027). A forum's queries are addresses: a section, or since
US-473 a feed. Their "words" are a host and a path: "sawmillcreek",
"forums", "index", "rss". A forum post rarely uses them, so the stage
dropped forum posts at random. A local BuyerFinder scan on 2026-10-31 read
29 forum posts and the keyword stage dropped 28.

## Acceptance

- [x] A post from a platform whose queries are addresses passes the keyword
      stage; the embedding stage and triage judge it.
- [x] Every other platform keeps its own words, as before.
- [x] A test on a real Postgres fails without the fix.

## Notes

The forum platform has not reached an npm release, so no published monitor
was filtered this way.

## Log
