---
id: BUG-006
title: The first poll of a monitor stores no replies
type: bug
priority: p1
created: 2026-09-06T14:05+08:00
parent: US-020
area:
resolution:
---

## Context

The replies step asked every provider for comments written after the poll had
already started, so every comment it was sold fell outside the window and was
dropped. On the first poll of any monitor this made the whole feature store
nothing, and it was paid for in full.

The window was the later of a ninety-day floor and `monitors.last_polled_at`.
That mark is written by `collect.ts` when a collection finishes, and the
replies step runs after the filter in the same poll — so by the time the window
was computed the mark said "a few minutes ago", and no comment on a video
collected today is newer than that.

**Measured, on 2026-09-06, in US-044's live TikTok poll.** 60 videos were
collected, 33 survived the pre-filter, 25 threads were opened, 25 pages were
bought, and **0 comments were stored**. One of those threads was re-read by
hand afterwards: it holds 8 comments, written between January and July 2026.
With the correct window one of the eight was inside it. With the window the
step used, none of them were, and none of them ever would be.

The suite did not catch it for two reasons, and both are worth keeping in mind.
`insertMonitor` leaves `last_polled_at` null, so no case ever ran the live
shape. And the fake connector returned the whole thread whatever window it was
asked for, so the one case that did assert on the window asked what the caller
requested and never what came back.

**A thread is not a poll.** The poll mark belongs to the search: it says how
far back the next search must look for posts. A thread outlives the post above
it and we may meet it for the first time on any poll, however long the monitor
has been running. So the mark that says how much of a thread we have read
belongs on the post, and a thread nobody has read yet has no mark at all.

That is `posts.replies_read_at`, migration 0031. Null means never read and the
ninety-day floor applies. It is written from the time taken *before* the first
page rather than after the last, so a comment written while the walk was
running is read on the next pass instead of falling into the gap.

The re-open rule is unaffected: a thread whose reply count has not grown is
still skipped without a call, so the narrower window is not what stops a
monitor re-buying threads. What it stops is a second pass paying triage for
comments it already stored, which `posts` deduplicates but `filter` would
re-read.

## Acceptance

- [x] The window is the later of the ninety-day floor and this thread's own
      `replies_read_at`. `monitors.last_polled_at` is not consulted.
- [x] A thread that has never been read is read from the floor, however
      recently the monitor polled — asserted with the mark set to now, which is
      the live shape.
- [x] A thread read before is read from its own mark.
- [x] The mark is written from before the fetch, not after it.
- [x] The fake connector honours `since`, so a wrong window returns an empty
      page in a test the way it did in production.
- [x] Reverting the rule turns both new cases red, and the first one red by
      timing out with no reply reaching the filter — the live failure.
- [ ] A live poll stores a comment. US-044's run must be repeated, because
      the claim the TikTok integration rests on has still never been tested:
      nothing has yet classified a TikTok comment.

## Notes

Migration 0031 adds one nullable column and backfills nothing. Every existing
thread reads as never read, which is right: no thread's true read mark is
recoverable, and the floor is the safe direction.

`pnpm db:generate` wrote a migration holding every statement from 0025 onward,
because the snapshots in `drizzle/meta` have been stale since 0025 and the diff
was taken against one. The migration was replaced by hand with the one
statement. The 0031 snapshot is accurate against `schema.ts`, so the next
generated diff will be correct.

## Log

- 2026-09-06T14:05+08:00 — Found by US-044's live TikTok poll: 25 threads
  opened, 25 pages bought, 0 comments stored. Cause found, fixed, and covered
  by three cases. One box open: no live run has stored a comment yet.
