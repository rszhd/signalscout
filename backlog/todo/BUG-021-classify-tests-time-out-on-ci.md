---
id: BUG-021
title: The classify tests time out on CI, and a red release run looks like the change
type: bug
priority: p2
created: 2026-09-19T02:01+08:00
parent:
area: testing
resolution:
---

## Context

`packages/pipeline/src/worker/classify.test.ts` fails on GitHub's runner at
random, with no assertion broken:

    Error: Timed out waiting for the classify job to finish.
     ❯ until packages/pipeline/src/worker/testing.ts:91:9
     ❯ classifyAndWait packages/pipeline/src/worker/classify.test.ts:195:3

    Error: Timed out waiting for the monitor to be notified.
     ❯ until packages/pipeline/src/worker/testing.ts:91:9
     ❯ packages/pipeline/src/worker/classify.test.ts:464:5

Twice so far. On `main` for pull request #20 (run 35327243495), and on the
0.9.0 release pull request #21 (run 35375101543), where two tests failed
together out of 2,106. A re-run of the same commit passed both times, and the
file passes locally — 22 tests in 37 seconds.

**`docs/testing.md` already predicted this.** Its *Six workers were tried and
reverted* paragraph says that at six workers this exact file failed two runs in
four, "an `until()` wait exceeding its twenty seconds under load rather than a
broken assertion", and that two seconds of wall clock is not worth a suite that
cries wolf. `vitest.config.ts` caps the run at four workers, which holds on a
development machine. The CI runner is slower, and four there is doing what six
did here.

**The cost is not the re-run.** It is that a red run on a release pull request
reads as the change under test. The 0.9.0 release stopped for it, and the next
person will spend the same minutes on the same diff. That is also why raising
the `until` timeout is the wrong answer: `docs/testing.md` says a widened
timeout hides a real defect inside the number a busy machine produces, and this
ticket must not be closed by making the number bigger.

## Acceptance

- [ ] The cause is named. Either this file waits on something that genuinely
      takes longer than it should, or the run is too wide for the runner —
      `--reporter=json` gives the per-file timings that tell the two apart.
- [ ] Twenty consecutive CI runs of the suite on an unchanged commit pass.
- [ ] `until`'s default timeout is unchanged, or the change is argued in
      `docs/testing.md` beside the paragraph that argues against it.
- [ ] Whatever is learned goes into `docs/testing.md`, beside the six-worker
      measurement it continues.

## Notes

- `packages/pipeline/src/worker/testing.ts:78` is `until`, 20 seconds by
  default. The second failing test sets a 30-second vitest timeout of its own,
  which the `until` inside it never reaches.
- `vitest.config.ts:55` caps `maxWorkers` at 4; line 90 caps each pool at 3;
  line 102 sets `WORKER_POLLING_INTERVAL_SECONDS` to pg-boss's floor of 0.5 for
  the suite. `.github/workflows/ci.yml` overrides none of them, so CI runs the
  same four workers on a smaller machine.
- The file is the slowest of the worker files at 37 seconds for 22 tests, which
  is worth measuring before anything is changed. Each test sends a job and waits
  for a worker to poll for it.
- Not caused by US-216 or 0.9.0: the first failure predates both.

## Log

- 2026-09-19T02:01+08:00 — Written after the second sighting, on the 0.9.0
  release pull request. Both sightings re-ran green on the same commit.
