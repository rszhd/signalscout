---
id: BUG-323
title: A lost write-back opens a second issue for one ticket
type: bug
priority: p2
created: 2026-09-23T05:44+08:00
parent: US-299
area: backlog
resolution:
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

- [ ] Before `gh issue create`, `sync.sh` searches for an issue labelled
      `ticket` whose title starts with `<id>:`, and adopts it if there is
      exactly one.
- [ ] With more than one match it stops and names them, and creates nothing.
- [ ] `--check` reports a ticket that has two open issues.
- [ ] #63 is closed as a duplicate of #64.

## Notes

- `backlog/sync.sh`, the `create` branch near line 117.
- The search runs only when `issue:` is empty, so a normal run costs no extra
  API call.

## Log

- 2026-09-23T05:44+08:00 — Found in a review: two open issues for BUG-311, created 7 h 20 min
  apart, each at the time of a commit that touched the ticket.
