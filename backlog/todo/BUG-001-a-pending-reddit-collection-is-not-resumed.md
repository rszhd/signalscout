---
id: BUG-001
title: A pending Reddit collection is not resumed
type: bug
priority: p0
created: 2026-09-05
parent: US-007
area: sources
resolution:
---

## Context

Bright Data collections are asynchronous. The first Reddit search triggers a
collection and returns `next: { status: "wait", retryAfter, cursor }`. The
cursor holds the snapshot id that the next attempt must read.

The collector drops that cursor when it turns the result into a
`SourceOutcome`. The poll job then completes. Nothing persists or schedules the
continuation. When the monitor becomes due again, the scheduler starts a new
poll with no cursor, so the connector triggers another collection instead of
reading the snapshot it already started.

This is both a silent empty-inbox failure and a cost risk. A job reports
`completed`, but no post can reach the filter or classifier. Repeated polls can
start repeated collections for the same search. Cursor and deduplication are a
correctness-critical surface in `docs/testing.md`, so the regression assertions
are written before the fix.

The first live run exposed it. The `Journeys` monitor was created active with
six queries and five subreddits. A `poll` job completed and advanced
`last_polled_at`, but the database held zero posts, zero matches and no
classification model calls. The only model call was query generation.

## Acceptance

- [ ] A source response with `next.status === "wait"` creates a durable
      continuation that keeps its cursor and does not run before `retryAfter`
- [ ] The continuation calls the source with the same cursor, so the existing
      snapshot is read without triggering the collection again
- [ ] A process restart between the trigger and `retryAfter` does not lose the
      continuation
- [ ] A schedule tick while a continuation exists cannot trigger a second
      collection for the same monitor and source
- [ ] Posts returned after the wait are stored and enqueue the filter exactly
      once
- [ ] A live Bright Data run triggers one collection, resumes its snapshot and
      stores the returned posts

## Notes

- Parent: [US-007](../doing/US-007-the-worker-runs-jobs-on-a-schedule.md).
- `packages/core/src/worker/collect.ts` drops the cursor on the wait branch and
  returns from the poll job.
- `packages/core/src/sources/reddit/index.ts` puts the snapshot id in the
  cursor and reads the snapshot only when that cursor comes back.
- Read `docs/sources.md` before changing the connector contract. The interface
  already gives the caller both `retryAfter` and `cursor`; the missing behavior
  is in the caller.
- No automated test may reach Bright Data. Use an injected source to prove the
  durable continuation and keep the final live run as a manual verification.
- The trigger reached the real provider. Snapshot retrieval, expiry and rate
  limiting remain unproven until their respective paths happen live.

## Log

- 2026-09-05 — Recorded from the first monitor created through the real UI and
  run against a live Bright Data key. The monitor was active, the scheduler
  ticked and the poll job completed, but no continuation or post followed.
