---
id: US-203
title: A stage says which collection it belongs to
type: feature
priority: p1
created: 2026-09-18T10:39+08:00
parent: US-201
area: pipeline
resolution: shipped
---

## Context

US-201 gave every stage a row and left out the one field that ties the rows
together. The history screen it feeds shows this, on a real monitor polling a
subreddit deep enough to page:

    Filtered 71 posts — 70 kept
    Filtered 121 posts — 116 kept
    Last poll: 71 posts, 71 new
    Filtered 120 posts — 119 kept
    Last poll: 121 posts, 28 new

Four polls of one paging walk, four filters, interleaved by start time,
because a filter for one poll runs while the next poll is already collecting.
Every line is true and the reader cannot pair any of them.

`poll_runs` has `walk_id` for exactly this reason — US-104 added it so that
fifteen poll jobs read as one collection rather than fifteen failures. The
stages after the poll belong to the same collection and had no way to say so.

The walk cannot be derived after the fact. A stage knows its posts, and a post
carries no walk; reading "the monitor's newest poll" would attribute a
classification to whichever poll happened to be running when it finished,
which is the wrong one precisely when the screen is confusing. So the walk
travels with the work: the poll puts it in the job it sends, and each stage
passes it to the next.

## Acceptance

- [x] Every pipeline payload after the poll carries the walk it belongs to.
- [x] The poll sends the walk it just recorded, not a second lookup.
- [x] A stage writes the walk on its row, and passes it to the stage it
      enqueues — including the replies stage's loop back into the filter.
- [x] A job sent by an older worker, with no walk in it, writes null rather
      than refusing.
- [x] `stage_runs.walk_id` is indexed for the read that groups by it.
- [x] The vocabulary and the migration agree, and both are in this change.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- `walkFor` is called once per poll now and used twice: the row and the job.
- The notify sweep has no walk. `enqueueNotifications` is not a stage of a
  collection, so those rows keep a null walk, which is the truth.

## Log

- 2026-09-18T10:39+08:00 — Written from a screenshot of the history on the
  local instance, where four polls of one walk interleaved with their filters.
- 2026-09-18T11:46+08:00 — Built it. The poll reads its walk once and uses it
  twice — the row it writes and the job it sends — because two lookups could
  answer differently: the first writes a row the second would then read.
- 2026-09-18T11:46+08:00 — Proved on the local instance rather than only in
  the suite: a monitor polled four times, and all eighteen stage rows came out
  carrying the same walk as their polls.
- 2026-09-18T11:46+08:00 — 2082 tests, lint and typecheck pass.
