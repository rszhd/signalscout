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

- [x] A source response with `next.status === "wait"` creates a durable
      continuation that keeps its cursor and does not run before `retryAfter`
- [x] The continuation calls the source with the same cursor, so the existing
      snapshot is read without triggering the collection again
- [x] A process restart between the trigger and `retryAfter` does not lose the
      continuation
- [x] A schedule tick while a continuation exists cannot trigger a second
      collection for the same monitor and source
- [x] Posts returned after the wait are stored and enqueue the filter exactly
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
- The scheduler was left alone. `findDueMonitors` still asks only about the
  poll interval, so a continuation is woken by the job the collector books. A
  monitor whose wake-up job reaches the dead letter queue waits for its own
  interval before the row is read. That is a bounded delay and not a lost
  collection, so it does not earn a second query in the scheduler yet.
- The trigger reached the real provider. Snapshot retrieval, expiry and rate
  limiting remain unproven until their respective paths happen live.

## Log

- 2026-09-05 — Recorded from the first monitor created through the real UI and
  run against a live Bright Data key. The monitor was active, the scheduler
  ticked and the poll job completed, but no continuation or post followed.
- 2026-09-05 — Fixed, except the live run. Five boxes are true; the sixth needs
  a Bright Data key and is left open. Notes on the decisions the code cannot
  hold:

  **The continuation is a row, not a job payload.** Migration 0005 adds
  `source_continuations`, one row per monitor per source, and the poll job that
  follows only wakes someone to read it. Carrying the cursor in the payload
  alone was the first design and it loses the cursor in one real case: the poll
  queue is `stately` on the monitor id, so if a scheduler tick has already
  queued a poll for that monitor, the send that carries the cursor is refused
  and answers `null`. A row cannot be refused, and the poll that was already
  queued finds it.

  **`UNIQUE (monitor_id, source)` is the "no second collection" rule.** Two
  workers polling one monitor at once is a state this product expects, so the
  rule is a constraint and not a comparison in the collector. The collector's
  own guard is the other half: a source whose `resume_after` has not passed is
  skipped, not asked. Both were mutated to confirm each fails on its own.

  **`since` is carried in the row and written once.** The poll mark moves when
  the collection is triggered, so a resume that read `monitors.last_polled_at`
  would ask for posts newer than the trigger and drop every record the
  collection had already been billed for. This was not in the original report
  and is the second half of the same bug: fixing the cursor alone would have
  produced an empty inbox again, from a resume that worked.

  **A collection that never becomes ready is abandoned after 120 resumes.**
  About an hour at the provider's own thirty-second hint. Without a cap the
  fix replaces one silent failure with another: a poll job every thirty
  seconds for the life of the monitor. Giving up deletes the row and triggers
  nothing in its place, so the recovery costs nothing until the next scheduled
  poll.

  **The regression assertions were written before the fix**, as
  docs/testing.md requires for cursor and deduplication. Six mutations were
  then applied one at a time to the finished code — the dropped wait cursor,
  a resume that starts over, the missing not-due guard, the missing cap, the
  poll mark read in place of the stored window, and the unbooked alarm. Each
  one turned at least one test red.

  **What the restart box rests on.** The resume test builds a new registry, a
  new source and a new step, so nothing the resume knows was held in memory by
  the poll that triggered the collection. Both the row and the pg-boss job are
  in Postgres. No test kills a process; that is the limit of the claim.

  **Unproven until it runs somewhere real.** Every test drives the fake
  connector with a `fetch` that cannot reach anything. A completed Bright Data
  snapshot, an expired one and a real rate limit have still never happened
  here. The next run against a live key is what finds out.
