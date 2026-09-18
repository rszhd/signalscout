---
id: US-212
title: A post remembers the query that found it
type: feature
priority: p1
created: 2026-09-18T14:53+08:00
parent:
area: pipeline
resolution: shipped
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

- [x] A candidate post carries the query that returned it, from every connector
      that searches by query.
- [x] A post found by browsing a channel rather than by a query records the
      channel, and is not attributed to a query.
- [x] A poll records, per monitor, which query found which post — every query
      that returned it, not only the first.
- [x] Recording it changes nothing about deduplication, the `posts` row, or
      what a poll costs.
- [x] A read answers, for one monitor: per query, how many posts it found, how
      many became matches, the best score, and when it last found anything.
- [x] Posts stored before this exist with no attribution, and the read says so
      rather than counting them against a query.
- [x] `pnpm test`, lint and typecheck pass.

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
- 2026-09-18T15:24+08:00 — Built it. The answer sits on the page rather than on
  each post: every connector here reads one input per request, so a page shares
  an answer and each connector needed one line rather than a map over its
  results. The collector copies it onto the posts as it merges pages, which is
  the step where the association used to be lost.
- 2026-09-18T15:24+08:00 — A post returned by two phrases keeps both rows. The
  batch is deduplicated before it is stored, so recording only the survivor's
  phrase would credit one search and hide the other.
- 2026-09-18T15:24+08:00 — Writing the rows never fails the poll. The posts are
  stored and paid for by then, and losing the note is cheaper than losing the
  collection.
- 2026-09-18T15:24+08:00 — 2093 tests, lint and typecheck pass. Eleven
  connectors carry it, including the fake one every pipeline test runs through.
