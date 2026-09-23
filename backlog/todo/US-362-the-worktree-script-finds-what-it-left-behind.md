---
id: US-362
title: The worktree script finds what it left behind
type: chore
priority: p3
created: 2026-09-23T14:32+08:00
parent:
area: tooling
resolution:
---

## Context

On 2026-09-23 this machine held about 3.4 GB of old worktrees and five
Postgres containers. `worktrees/us-136` (498 MB) had a folder and a running
database, but `git worktree list` did not name it. Other leftovers were
`~/projects/intentwatch-us135`, the `intentwatch-postgres-1` container from
the old project name, and a `.claude/worktrees/bridge-…` folder.

`remove-worktree.mjs` removes one worktree it is told about. Nothing finds a
worktree that was removed another way.

## Acceptance

- [ ] `node scripts/remove-worktree.mjs --prune` lists folders under
      `worktrees/` that git does not know, and compose projects of this
      repository whose worktree is gone
- [ ] It removes nothing without a confirmation, and `--dry-run` removes
      nothing at all
- [ ] It never touches the main checkout's compose project
- [ ] A test covers a known worktree, an orphan folder and an orphan project

## Notes

The memory rule on compose projects applies: test with `-p <unique>` only.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
