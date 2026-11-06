---
id: BUG-530
title: The stage-runs bound test times out on CI
type: bug
priority: p2
created: 2026-11-06T15:09+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

"keeps a monitor's rows bounded" in `worker/stage-runs.test.ts` wrote 803
stage runs one by one through `recordStageRun`, and each write also trims the
monitor's oldest rows. Locally that took about 0.9 s. On CI it passed the
five-second test limit and failed the 0.26.3 release run (42178429435). An
earlier CI failure in the same file (run 35308792846) had no cause recorded.

The test now fills the table to the bound in one insert and sends only the
three writes past it through `recordStageRun`, which is the part that trims.
It also checks that the oldest rows went, not the newest.

## Acceptance

- [x] The test fills the bound in one statement and writes the rows past it through `recordStageRun`.
- [x] It checks the count and that the three oldest rows were trimmed.
- [x] It runs in well under a second locally.
- [x] The release CI run passes with it (run 42179027794).

## Notes

## Log

**2026-11-06T15:09+08:00.** Before: 864 ms locally, over 5,000 ms on CI.
After: 69 ms locally.
