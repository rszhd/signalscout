---
id: US-419
title: Query performance shows what each phrase costs
type: feature
priority: p1
created: 2026-09-26T02:07+08:00
parent:
area: pipeline
resolution:
---

## Context

**A phrase is paid for on every poll, and nothing on screen says how much.**
The query performance view (US-212, US-267) shows posts found, matches, the
best score and when a phrase last matched. A phrase that fetches 40 posts a
poll and never matches looks the same as one that fetches 2: both show 0
matches, and only one of them is burning money.

**Radar showed what the number does (signalscout-radar, `pnpm phrases`).** It
ranks every phrase and subreddit by requests per dollar. One look showed some
subreddits at 2,500 requests per dollar and others at none, and the weak ones
were dropped the same night.

Cost per phrase is not a guess: the provider's units per request are already
recorded, and `post_discoveries` says which input a post came from. The
split of a request's cost between phrases is the part to decide: one request
carries one input, so a page's units belong to the phrase that bought it.

## Acceptance

- [ ] Every phrase and subreddit in query performance shows its estimated
      provider cost over the same window as its counts, labelled estimated
- [ ] A phrase with matches shows cost per match; a phrase with none shows
      its cost and "no match yet"
- [ ] Both applications show it (the view lives in `packages/ui`)
- [ ] A test proves a page's units are counted against the phrase that
      bought it, and against no other

## Notes

- `packages/pipeline/src/monitors/query-performance.ts`,
  `packages/ui/src/QueryPerformance.tsx`.
- Radar's version: signalscout-radar `src/db/migrations/002-phrase-stats.sql`.

## Log
