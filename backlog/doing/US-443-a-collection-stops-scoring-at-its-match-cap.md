---
id: US-443
title: A collection stops scoring at its match cap
type: feature
priority: p2
created: 2026-09-30T23:41+08:00
parent:
area: worker
resolution:
---

## Context

An application that shows a person a short list does not need every match a
collection could make, and each one past the list is paid for: a
classification, and with US-441's rescorer a second, dearer call. A private
experiment on these packages (US-434) had a scan make 75 matches, 63 of them
strong, at $0.90, where its page shows 50.

The classify step can stop once a collection has enough. The posts it does
not read are written as drops, as the daily ceiling's are (US-287), so a
screen that counts what was seen does not wait for them.

## Acceptance

- [x] `createClassifyStep` and `startWorker` take `matchesPerCollection`, a
      whole number of 1 or more; unset, nothing changes; below one throws.
- [x] Once a walk has that many matches, the step reads no more of its posts
      and writes each as a `match_cap` drop; no model is called for them.
- [x] Every classify job of one walk shares the count; the next walk starts
      again. A job with no walk counts only its own matches.
- [x] Migration 0074 adds `match_cap` to the drop stages.
- [x] Tests cover the stop, the shared count, the next walk, no cap, and the
      range; nothing reaches a model.
- [ ] One live scan on BuyerFinder with the cap set, and the Log gives the
      matches, the capped posts and the cost.

## Notes

- `packages/pipeline/src/worker/classify.ts`, `matchesInWalk`.
- Calls already in flight finish, so a collection can end up to
  `concurrency - 1` matches over the cap.
- A match counts from the start of its walk's first poll row.

## Log

- 2026-09-30 23:41 — Opened and built. The owner chose a cap that stops
  scoring over one that only hides matches. Five tests in
  `classify-match-cap.test.ts`; with the classify and schema tests, 144 pass.
