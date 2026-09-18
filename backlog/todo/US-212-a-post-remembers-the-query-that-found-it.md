---
id: US-212
title: A post remembers the query that found it
type: feature
priority: p1
created: 2026-09-18T14:53+08:00
parent:
area: pipeline
resolution:
---

## Context

A monitor searches five phrases across eight subreddits and nobody can say
which of the five earns anything. A query that has never produced a match is
pure spend: it is searched on every poll, on every channel, for ever, and the
only way to find it today is to delete one and watch what happens.

**The information exists and is thrown away.** A connector loops per query and
per channel, so at the moment a post is returned it knows exactly which search
produced it. `CandidatePost` has no field for it, `posts` has no column for it,
and by the time a batch reaches the poll the association is gone.

**It cannot be recovered afterwards**, and this is the part worth being firm
about. A provider's search is not a substring match — stemming, ranking, phrase
handling — so checking which query's words appear in a post is a guess dressed
as a fact. One post is commonly returned by several queries and the poll
deduplicates them into one row, so the truth is many-to-many from the start.
And `posts` is keyed by `(source, external_id)` with no monitor column, because
one row serves every monitor that found it, while a query belongs to one
monitor. The link cannot live on the post. It needs a row of its own.

What this buys, beyond curiosity: the cost measured on 2026-09-18 was $0.25 a
day of provider fetching and $0.87 of classification, and a query that finds
nothing contributes to both halves while producing no lead. A person cannot
prune what they cannot see.

## Acceptance

- [ ] A candidate post carries the query that returned it, from every connector
      that searches by query.
- [ ] A post found by browsing a channel rather than by a query records the
      channel, and is not attributed to a query.
- [ ] A poll records, per monitor, which query found which post — every query
      that returned it, not only the first.
- [ ] Recording it changes nothing about deduplication, the `posts` row, or
      what a poll costs.
- [ ] A read answers, for one monitor: per query, how many posts it found, how
      many became matches, the best score, and when it last found anything.
- [ ] Posts stored before this exist with no attribution, and the read says so
      rather than counting them against a query.
- [ ] `pnpm test`, lint and typecheck pass.

## Notes

- The new table is the join the posts table cannot hold: monitor, post, query
  or channel, and when it was first seen. It is written by the collect step
  where the batch is stored.
- Six platforms across four providers each loop somewhere; the change per
  connector is small and the fixtures already exercise the loops.
- **Cost per query is a second step, not this one.** The connector knows which
  search it was billed for, so `api_usage` could carry the query later and the
  screen could rank by cost per match. This ticket stops at what was found.
- The screen is US-213 in the hosted repository, and it cannot start until this
  is released.

## Log

- 2026-09-18T14:53+08:00 — Asked for by the owner after reading a day of spend:
  three active monitors, 1,825 classifications, and no way to tell which
  phrases earned them.
