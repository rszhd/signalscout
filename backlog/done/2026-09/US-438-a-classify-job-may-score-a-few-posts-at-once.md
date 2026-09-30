---
id: US-438
title: A classify job may score a few posts at the same time
type: feature
priority: p2
created: 2026-09-29T23:45+08:00
parent:
area: classifier
resolution: shipped
---

## Context

The classify step scores one post after another. Two rules put it there: the
model provider's rate limit, which a burst of parallel calls hits at once,
and the spend meter (BUG-004), which checks the monitor's cap before every
call and could not count calls that have started and not yet reported.

One at a time is slow when a person waits for the answer. In a private
experiment on these packages (US-434), deepseek-flash took 5.0 seconds a
post on average and 9.2 at the 90th percentile over 476 calls, so a scan
that sends 100 posts to the classifier waits about eight minutes.

So an application may ask for a few calls in flight, and every rule the
one-at-a-time loop keeps still holds:

- The posts start in the order they were handed. The skips, the copy rule
  (US-400), the cap check and the daily ceiling stay in that loop; only the
  call and what follows it run beside others.
- A copy of a post waits for the post it copies, so the card rule reads its
  answer before it decides.
- The meter reserves what the calls in flight may cost, the calls in flight
  times the largest call so far, and the first call runs alone so there is a
  price to reserve. The cap is crossed by at most one call, as it is today.

The default stays one. Neither application changes unless it sets it.

## Acceptance

- [x] With no option, the step scores one post at a time.
- [x] With `concurrency: 4`, at most four calls are in flight and every post
      is scored.
- [x] A copy of a post in the same batch is still carried by its card, not
      scored.
- [x] With a cap, four in flight spend no more than one at a time does.
- [x] The option refuses a value below 1 or above 16.
- [x] `startWorker` takes it as `classifyConcurrency`.
- [x] The suite passes.

## Notes

- `createClassifyStep` in `packages/pipeline/src/worker/classify.ts`; the
  reservation is `SpendMeter.exhausted(reservedMicros)` in
  `budget/budget.ts`. Both are correctness-critical surfaces.
- Tests: `worker/classify-concurrency.test.ts`, written first.

## Log

- 2026-09-29T23:45+08:00 — Built on the owner's word, four at a time for Lookout. Tests first:
  the default one at a time, four in flight, a copy waiting for its post,
  the cap, the range. A task is marked handled as it starts, so a throw
  while the loop awaits the database does not stop the process; the loop
  still sees it and the job fails as before. Not run against a real
  provider's rate limit yet.
- 2026-09-30T10:11+08:00 — Shipped in 0.19.0 (tag v0.19.0, merge commit f94b846).
