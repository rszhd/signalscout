---
id: US-422
title: A phrase that hits the page limit says so
type: feature
priority: p2
created: 2026-09-26T02:07+08:00
parent:
area: engine
resolution:
---

## Context

**The connectors stop at two pages per phrase per poll and answer `done`.**
The limit is right: one keyword must not eat a poll (docs/pipeline.md, *The
caps*). But `done` also means "this query has nothing more", so a caller
cannot tell a quiet phrase from a busy one that was cut off.

**Radar met it without seeing it (2026-09-26).** Its runs spent a third of
their budget and stopped; a probe showed X and Reddit answering `done` after
two pages of posts only minutes old. A monitor with a busy phrase has the same
ceiling on every poll, and nothing records it.

## Acceptance

- [ ] A search result says when it stopped because of the page limit, not
      because the query ran out, on every connector that has the limit
- [ ] The pipeline records it per phrase per poll
- [ ] Query performance shows a phrase that hit the limit on most polls, so a
      person can narrow it
- [ ] The engine's CHANGELOG says what a consumer sees

## Notes

- `maxPagesPerInput` in `packages/engine/src/sources/providers/*/`.
- A new field on `SearchResult` or a new `NextPage` status; decide which.

## Log
