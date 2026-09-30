---
id: US-441
title: A second model confirms a match before it is written
type: feature
priority: p2
created: 2026-09-30T14:32+08:00
parent:
area: ai
resolution:
---

## Context

The classifier reads every post the free stages and triage keep, so it runs
on a cheap model. Most of what it reads scores low and costs little. The few
posts that pass the monitor's bar are the ones a person reads, and a cheap
model's score on those decides what reaches the inbox and the email.

A private experiment on these packages (US-434) wrote a command that scores
the matches again with a stronger model, after the fact, and writes the new
scores over the old. It works, but a person has already seen the first score,
and the daily email may already have gone.

The step can do this itself. A post that passes the bar is read once more by
a second model before its match is written; the second score is the one the
match gets. A post the second model scores below the bar gets no match. Only
posts that passed pay for the second call, so the cost follows the matches,
not the posts read.

## Acceptance

- [x] `createClassifyStep` takes a second classifier per owner, as it takes
      the first (`rescorerFor`). Absent, the step does what it does today.
- [x] A post the first model scores at or above the bar is classified again
      with the same input, thread included. The match is written with the
      second model's scores. A second score below the bar writes no match,
      and the post counts as scored below the bar (the copy rule reads it).
- [x] A second call that fails or is refused does not lose the post: the
      match is written with the first model's scores, and a warning is logged.
- [x] The second call is recorded in `model_calls` with its own purpose,
      `rescore`, so a count of classifications stays one per post, and the
      monitor's spend and the budget cap include it.
- [ ] The cap's reservation for calls in flight counts both calls of a post.
- [ ] `startWorker` takes the option (`rescorer`), for every owner on the
      instance. Off by default: a monitor's scores do not change unless an
      application turns it on, so the scoring captures are not needed.
- [x] Tests cover: a confirmed match, a match the second model drops, a
      second call that fails, and no rescorer.
- [ ] One live scan with the rescorer on (BuyerFinder, gpt-6-sol), and the
      Log gives each match's first and second score and the cost.

## Notes

- `packages/pipeline/src/worker/classify.ts`, `scoreOne`; `runtime.ts`;
  `db/schema/vocabulary.ts` and a migration for the purpose check.
- The experiment's command, for comparison: `signalscout-lookout`,
  `src/worker/rescore.ts` (private repository), commits d344142..06a25eb.
- Cloud: the new purpose's migration runs on its next upgrade. Nothing in the
  cloud writes `rescore` until it passes a rescorer.

## Log

- 2026-09-30 14:32 — Opened. The owner asked for the experiment's rescore to
  become an option on the pipeline.
- 2026-09-30 14:40 — Built. `createClassifyStep` takes `rescorerFor`,
  `startWorker` takes `rescorer`, and migration 0073 adds `rescore` to the
  purpose check. `classify-rescore.test.ts` covers the four cases and no
  rescorer; the pipeline suite passes (155 files, 2594 tests), and lint and
  the type-check pass. The monitor's spend and the monthly budget sum
  `model_calls` over every purpose (`budget.ts`), so they include the second
  call; no test says so. The reservation takes the largest cost of both calls
  of one post, but only after a post has been rescored: before that it counts
  one call. No test covers it, so its box stays open. BuyerFinder runs it
  against this working copy with `LOOKOUT_RESCORE=on`; not live yet.
