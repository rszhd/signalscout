---
id: US-245
title: A poll that billed for zero posts is legible
type: chore
priority: p3
created: 2026-09-20T00:56+08:00
parent: US-104
area: web
resolution:
---

## Context

US-104 made a monitor say what its last poll did, after a production poll
billed 82 credits for zero posts and only the database could explain it. The
screen is built and tested against recorded rows; nothing has shown it on a
real run of that shape. Parked until one happens.

## Acceptance

- [ ] After a live poll that bills credits and stores no posts, the monitor
      screen says so without a database, and the Log says what it showed.

## Notes

- `docs/pipeline.md` says which rows a poll writes.

## Log

- 2026-09-20T00:56+08:00 — Split out of US-104 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
