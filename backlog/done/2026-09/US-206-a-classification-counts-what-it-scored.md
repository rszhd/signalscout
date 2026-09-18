---
id: US-206
title: A classification counts what it scored
type: bug
priority: p1
created: 2026-09-18T12:48+08:00
parent: US-201
area: pipeline
resolution: shipped
---

## Context

Two lines from the history of one monitor, both true to the row behind them
and both wrong:

    Scored 116 posts — 27 matched, 1 left unclassified — the job failed
    Scored 116 posts — 0 matched, 1 left unclassified — the job failed

They are one job and its retry. The first ran for five minutes and really did
score 116 posts. The second ran for **four seconds**: BUG-003's skip found 115
of them already scored in the call ledger, so it asked the model once, failed
again, and matched nothing. A four-second run cannot have made 116 model calls,
and the row said it did.

`scored` was `candidates.length - retryable - dropped - unspentFor`, which
counts every post the run looked at, including the ones it skipped because
somebody had already paid to score them. The skip is the whole of BUG-003 and
it is invisible in the record of the work.

So: count what this run actually scored, and record the skip beside it. Then a
retry reads as a retry — one post attempted, 115 already done — instead of as
a second full classification that produced nothing.

## Acceptance

- [x] `scored` is the number of posts this run got an answer for from the
      model, not the number it considered.
- [x] A new `skipped` count says how many were already scored under this
      monitor's current version.
- [x] `scored` plus `skipped` plus the failures equals what the run was handed.
- [x] A retry of a finished batch records a run that scored almost nothing,
      and says why.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- `alreadyScored` is the set; the skip is the first `continue` in the loop.
- The hosted application's history reads this. Its sentence changes with it,
  and both are built against the working copy before anything is released.

## Log

- 2026-09-18T12:48+08:00 — Found by the owner reading the history on the local
  instance: two identical "Scored 116 posts" lines, one of which took four
  seconds.
- 2026-09-18T12:56+08:00 — Counted in the loop instead of derived from the
  candidate list, and the skip counted beside it. The log line carries both, so
  the row and the log cannot drift.
- 2026-09-18T12:56+08:00 — The test runs the step twice over one post, which
  is the retry in miniature: 1 scored and 0 skipped, then 0 scored and 1
  skipped. 2083 tests, lint and typecheck pass.
