---
id: US-216
title: The run is written down
type: chore
priority: p1
created: 2026-09-18T15:09+08:00
parent:
area: docs
resolution: shipped
---

## Context

The owner asked how the pipeline handles several keywords and several
platforms, and the answer took four readings of `collect.ts` and one connector
to assemble. It is not written anywhere. PLAN.md holds the diagram — sources
into a pre-filter into a classifier into matches — which says what the pipeline
is for and nothing about how it runs.

What was missing is the operational half: that a poll stops at five pages and
books its own resume, that a walk is several polls, that the cursor holds a
phase, an input index and the provider's own place, that a post already scored
is skipped by asking the call ledger rather than `matches`, and which row each
step leaves behind for the screens to read.

Every one of those is the reason for a bug that has already been fixed once.
Somebody reading the code today has to rediscover them in the order they were
written rather than in the order they run.

## Acceptance

- [x] One document holds the run in order, from the scheduler's tick to the
      notification.
- [x] The four places the pipeline keeps its position are named together, with
      what each one remembers.
- [x] Every cap is listed with its value and what it stops.
- [x] Each step says which rows it writes, so a person reading the database
      knows where to look.
- [x] `AGENTS.md` sends a worker task to it, and PLAN.md's diagram points at it
      for the mechanics.
- [x] Every table and constant named in it exists, checked against the schema
      and the source rather than remembered.

## Notes

- It is reference, read on demand, so it sits in `docs/` and not in
  `AGENTS.md`, which is loaded into every session and is paid for every time.

## Log

- 2026-09-18T15:09+08:00 — Written from the code, with the numbers read out of
  `collect.ts`, `replies.ts`, `classify.ts`, `queues.ts` and the Reddit
  connector rather than from memory. The table names were checked against the
  running database.
