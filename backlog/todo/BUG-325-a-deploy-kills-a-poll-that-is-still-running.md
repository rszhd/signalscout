---
id: BUG-325
title: A deploy kills a poll that is still running
type: bug
priority: p2
created: 2026-09-23T06:27+08:00
parent:
area: self-hosting
resolution:
---

## Context

On SIGTERM the worker calls `boss.stop({ graceful: true })`, and pg-boss then
waits up to 30 seconds, its default, for running jobs to finish. Docker waits
10 seconds, its default, and then kills the container. No compose file sets
`stop_grace_period`.

So a deploy that lands during a poll can kill it in the middle of a paid call.
The job is retried later, and a provider that bills at call time may bill that
work twice. Deduplication stops the posts from being stored twice. It cannot
stop the second bill.

## Acceptance

- [ ] Every compose file that runs the worker sets `stop_grace_period`
      longer than the pg-boss stop timeout.
- [ ] The pg-boss stop timeout is set in the code, not left to the library
      default, with the reason beside it.
- [ ] `docs/self-hosting.md` says how long a deploy may take to stop the
      worker, and why.
- [ ] The Log records one `docker compose down` during a running poll, and
      what the worker logged.

## Notes

- `apps/api/src/index.ts` and `apps/api/src/worker.ts` handle the signals.
- `packages/pipeline/src/worker/runtime.ts`, `stop`.
- A LinkedIn run through Apify can take minutes, so no grace period covers
  every job. The retry must stay safe, and this ticket makes the common case
  finish.
- The hosted repository has its own compose files; flag this there.

## Log

- 2026-09-23T06:27+08:00 — Found in a review of the open repository.
