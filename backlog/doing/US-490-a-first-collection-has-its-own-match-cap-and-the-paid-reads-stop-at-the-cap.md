---
id: US-490
title: A first collection has its own match cap, and the paid reads before scoring stop at the cap
type: feature
priority: p1
created: 2026-11-01T11:39+08:00
parent: US-443
area: pipeline
---

## Context

`matchesPerCollection` (US-443) is one number for every collection of a
monitor. Once a walk has that many matches, the classify step reads no more
of its posts. The hosted lookout product wants two numbers: a first
collection that stops at 10 matches, and each later collection at 5. Its
owner decided this on 2026-11-01, knowing that the cap keeps the first
matches the classifier reaches, not the best ones.

The cap acts only in the classify step, the last one. The replies step
(threads under kept posts) and the complete step (partial posts read whole,
US-476) run before it and pay a provider whatever the walk already has. A
walk arrives in several batches, so a later batch can reach those steps
after the walk already has its matches. The owner asked that those steps
also stop, batch by batch.

## Acceptance

- [x] `startWorker` and the classify step take `firstMatchesPerCollection`,
      validated like `matchesPerCollection`. A monitor's first walk uses it;
      a later walk uses `matchesPerCollection`. Unset, the first walk takes
      `matchesPerCollection`, as before; neither set is no cap.
- [x] The replies step opens no thread for a batch whose walk already has
      its cap of matches, and records that it skipped them.
- [x] The complete step reads no page for such a batch and sends its posts
      on to the classifier unchanged, where the cap makes them `match_cap`
      drops.
- [x] A batch that arrives before the walk has its matches is read as today.
- [x] Tests for each case; `docs/pipeline.md` says the new rule.

## Notes

- `packages/pipeline/src/worker/classify.ts` (`matchesInWalk`,
  `isFirstWalk`, the cap check), `replies.ts`, `complete.ts`, `runtime.ts`
  (where the steps are built), `classify-match-cap.test.ts`.
- A walk with no `walk_id` has no count and no first walk: no cap applies,
  as today.

## Log
- 2026-11-01T11:53+08:00 — Built. DeepSeek Flash wrote it from a brief; reviewed.
  Two corrections: the first walk now falls back to `matchesPerCollection`
  when its own cap is unset (the brief had left it uncapped, which would
  have changed the meaning for any caller with one cap), and the replies
  test sent the same post twice, so its second run was skipped by the
  reply count and passed with the new branch removed; it now sends a fresh
  thread. Both open-step tests were run with the skip disabled and fail
  then. `match-cap.ts` holds `capForWalk`, `walkHasItsMatches` and
  `validateMatchCaps`. 829 pipeline tests pass; type check and lint pass.
  Not run live.
