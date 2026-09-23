---
id: BUG-021
issue: 35
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

- [x] The cause is named. Either this file waits on something that genuinely
      takes longer than it should, or the run is too wide for the runner —
      `--reporter=json` gives the per-file timings that tell the two apart.
- [ ] Twenty consecutive CI runs of the suite on an unchanged commit pass.
- [x] `until`'s default timeout is unchanged, or the change is argued in
      `docs/testing.md` beside the paragraph that argues against it.
- [x] Whatever is learned goes into `docs/testing.md`, beside the six-worker
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
- 2026-09-23T06:17+08:00 — **The cause is a dropped job, not load.** `notify` is a `stately`
  queue, and pg-boss builds its unique index on
  `(name, state, COALESCE(singleton_key, ''))`. The classifier sent notify
  with no key, so every monitor's notify shared one queued slot. While one
  waited, `send` returned null for the next, with no error, and
  `classifyAndWait` waited for a notify that did not exist. The scheduled
  sweep already keyed its notify by monitor.

  Nine CI runs failed in the last hundred. Four were this file: three in
  *is not sent to the model a second time when it scored below the
  threshold* (runs 35177984036, 35327243495, 34930983897) and one in *drops
  a post that has already failed too many times* (35696019453). The likely
  source of the waiting notify is a retry: `fastRetries` has
  `retryDelay: 0`, and a failing classify job sends its notify before it
  throws, so retries of *a model that fails* overlap the tests after it.
  That source is inferred from the code, not observed.

  Production had it too. An immediate email or webhook could wait up to one
  minute, for the sweep. The poll lost its notify row in the stage history,
  because the sweep's pass carries no poll.

  **Fix.** `sendNotify` in `worker/notify.ts` keys every notify by its
  monitor, and all four senders use it. A second job for the same monitor
  may still be dropped, and that loses nothing: the step delivers the
  monitor's outbox and never reads `matchIds`. `until` is unchanged.

  **Proved.** `worker/notify.test.ts` runs the production queue settings
  with no worker, so a job stays queued. Its first case fails every time
  without the key. A case in `classify.test.ts` reads the notify row's
  `singleton_key` after a real classify job, and fails without the key.
  With the fix, the full suite passes: 132 files and 2,323 tests at four
  workers, and four runs of four at six workers.

  **Not proved.** The old timeout did not reproduce on this machine, even
  at six workers, so the six-worker measurement in `docs/testing.md` is not
  explained by this and the four-worker limit stays. Twenty CI runs are
  still owed.

  Separate, not this cause: run 35308792846 failed in `stage-runs.test.ts`
  (*the notifier writes what it planned*). That test calls the step
  directly and never uses the queue.
