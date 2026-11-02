---
id: US-496
title: A capped collection scores its platforms in turn
type: feature
priority: p1
created: 2026-11-02T01:20+08:00
parent: US-490
area: pipeline
resolution: shipped
---

## Context

A collection stops scoring at its match cap (US-443, US-490). The classify
step scores posts in the order it is handed them and stops at the cap. The
order is the collect step's: every post of the first platform, then every
post of the next. A monitor that reads Reddit and forums therefore spends
its whole cap on Reddit whenever Reddit has enough matching posts, and its
forum posts are never scored. The owner saw this on the hosted BuyerFinder,
which caps a first search at 10 matches and an hourly one at 5.

Between the two steps, the filter step reads the posts back from Postgres
with no `order by`, so the order classify sees is whatever the database
returns. Today that is the insert order, which is why Reddit stays first.

The fix takes the platforms in turn: one post of each platform, then the
next of each, keeping every platform's own order. A platform that runs out
drops out of the turn. The daily per-pair ceiling reads a batch in handed
order (US-287, US-400); it counts per pair, and a pair belongs to one
platform, so taking platforms in turn changes no ceiling outcome.

## Acceptance

- [x] The collect step hands the filter step its posts with the platforms
      in turn: with Reddit posts r1 r2 r3 and forum posts f1 f2, the order
      is r1 f1 r2 f2 r3. Each platform keeps its own order.
- [x] The filter step hands triage, complete and classify its survivors in
      the order it was handed them, not the order Postgres returns.
- [x] A test with a cap of 2 and two platforms scores and matches one post
      of each platform when the first platform alone could fill the cap.
- [x] Lint, type check and the suite pass.

## Notes

- `packages/pipeline/src/worker/collect.ts`: `rowsOf` builds the list from
  `outcomes` with `flatMap`.
- `packages/pipeline/src/worker/filter.ts`: `readCandidates` has no order.
- `packages/pipeline/src/worker/classify.ts`: sorts its candidates by the
  handed order and stops at the cap (`matchedBefore + matchIds.length >= cap`).
- A walk can take several poll jobs (a page cap resumes it). The turn is
  per job; a later job of the walk reads only what is left.

## Log

- 2026-11-02T01:20+08:00 — Opened from the owner's report on BuyerFinder.
  Proposal agreed: platforms in turn, and the filter step keeps the handed
  order. A fixed share of the cap per platform was the other option; it
  gives almost the same result with more code.
- 2026-11-02T01:28+08:00 — Built (DeepSeek Flash, reviewed): `inTurn` in collect.ts orders the
  rows by platform in turn; the filter step sorts its candidates by the handed
  order. Lint, type check and 2,799 tests pass. Not yet run live.
- 2026-11-02T02:00+08:00 — Released in 0.23.1 (PR #123, tag v0.23.1). BuyerFinder runs on
  it since b98dbe9; its deploy passed.
