---
id: US-439
title: A worker may run a few jobs of one queue at once, one per monitor
type: feature
priority: p2
created: 2026-09-29T23:57+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

The worker takes one job at a time in each queue, for every monitor
together. In a private experiment on these packages (US-434), five scans
started together, and the last one's classify job waited about ten minutes
behind the others' before it began.

So `startWorker` takes `queueConcurrency`: each monitor queue (poll, filter,
replies, classify, notify) may run that many jobs at once. Two jobs of one
monitor still never overlap, because the spend meter and the copy rule read
one monitor's batch as a whole. Every pipeline job is sent with its monitor
as its pg-boss group (`forMonitor`), and the worker allows one job per group.

The group limit is `localGroupConcurrency`, kept in the worker's memory.
pg-boss's `groupConcurrency`, kept in the database, looks for a running job
of the group as it fetches, and two pollers fetching at the same moment both
find none: the test caught two jobs of one monitor running together with it.
So the rule holds within one worker process. Two worker processes on one
monitor are guarded no better than before this option, which is the case
the spend meter's re-read already covers.

## Acceptance

- [x] With no option, one job at a time in each queue.
- [x] With `queueConcurrency: 3`, up to three jobs of a queue run together,
      and never two of one monitor.
- [x] Every job the pipeline sends to a monitor queue carries its monitor as
      its group.
- [x] The option refuses a value below 1 or above 16, before connecting.
- [x] The suite passes.

## Notes

- `forMonitor` in `worker/queues.ts`; the options in `worker/runtime.ts`.
- Test: `worker/queue-concurrency.test.ts`, written first; it passed three
  runs in a row after the switch to the in-process limit.

## Log

- 2026-09-29T23:57+08:00 — Built on the owner's word, three at a time for Lookout. Jobs queued
  before an upgrade carry no group and are not held to the limit; they
  drain within minutes.
- 2026-09-30T10:11+08:00 — Shipped in 0.19.0 (tag v0.19.0, merge commit f94b846).
