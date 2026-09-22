---
id: BUG-323
issue: 66
title: A lost write-back opens a second issue for one ticket
type: bug
priority: p2
created: 2026-09-23T05:44+08:00
parent: US-299
area: backlog
resolution: shipped
---

## Context

BUG-311 has two open issues, #63 and #64. `backlog/sync.sh` knows a ticket's
issue only from the `issue:` field. The first run opened #63 at
2026-09-22T21:55+08:00, on the branch of 9e0f435, and wrote `issue: 63` into
that working tree; the write-back never reached `dev`. The next run, at
2026-09-23T05:15+08:00, found no field, opened #64 and wrote that (cf22aa9).

Any run from a worktree, a branch or a reset checkout can do this again. The
script should find the issue it already opened before it opens another.

## Acceptance

- [x] Before `gh issue create`, `sync.sh` searches for an issue labelled
      `ticket` whose title starts with `<id>:`, and adopts it if there is
      exactly one.
- [x] With more than one match it stops and names them, and creates nothing.
- [x] `--check` reports a ticket that has two open issues.
- [x] #63 is closed as a duplicate of #64.

## Notes

- `backlog/sync.sh`, the `create` branch near line 117.
- The search runs only when `issue:` is empty, so a normal run costs no extra
  API call. *Changed while building:* the run lists the open ticket issues
  once, at the start, because `--check` must see a duplicate beside a ticket
  that has its number. One list call per run.
- `scripts/backlog-sync.test.mjs` runs the script against a fake `gh`.

## Log

- 2026-09-23T05:44+08:00 — Found in a review: two open issues for BUG-311, created 7 h 20 min
  apart, each at the time of a commit that touched the ticket.
- 2026-09-23T06:02+08:00 — Shipped. `sync.sh` lists the open ticket issues
  once per run. A ticket with no number adopts the one issue titled with its
  id; with two it opens nothing, names both and exits 1. Every mode names a
  second open issue beside the one a file records. "Stops" was read per
  ticket: the run still syncs the other tickets and then exits 1.
- 2026-09-23T06:02+08:00 — `set_field` moved from `sed -i` to awk, and
  `mapfile` was avoided. The new test runs the script inside `pnpm test`, and
  GNU `sed -i` and bash 4 would fail it on macOS for a reason unrelated to the
  change. Not run on macOS: the claim rests on reading, not on a run.
- 2026-09-23T06:02+08:00 — Proved: 7 tests against a fake `gh`. Four fail on
  the old script, and three pass on both. `--dry-run` and `--check` against
  the real repository changed nothing and passed. Not proved live: an actual
  adoption, because no ticket lacks its number today. #63 was closed as not
  planned, with a comment naming #64.
