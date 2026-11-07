---
id: US-543
title: A caller may plan the pages of every later poll
type: feature
priority: p1
created: 2026-11-07T11:32+08:00
parent: US-528
area: pipeline
resolution:
---

## Context

US-528 lets `firstPollPagesPerInput` be a function, so a caller sizes each
monitor's first poll to its own budget. Every later poll still takes one
`pollPagesPerInput` for the whole worker.

A hosted application keeps each monitor to a daily budget spread over the
hours of the day. With one fixed count, an hourly poll on a busy monitor
reads all its pages at once, spends more than its hour's share, and the
caller must then refuse the next hours. The caller wants each hour to run
and read only what that hour's share buys. It knows the monitor's spend and
the pipeline does not, so the count must be the caller's, for each poll.

So `pollPagesPerInput` may also be a `PagePlan`. The collect step asks it
on every poll after the first, resumed walks too, with the monitor, before
it marks `last_polled_at`, and checks the count before any source is asked,
as US-528 does for the first poll. A throw fails the job, which retries.
Unset, or a plain count, nothing changes.

A count the plan cuts short is not lost: the page cap already remembers the
cursor (US-435), and the walk continues on the next poll.

## Acceptance

- [x] `pollPagesPerInput` takes a `PagePlan` on `startWorker` and the collect step.
- [x] The plan is asked on every later poll with the monitor, and not on a first poll.
- [x] A plan that returns nothing leaves the connectors' caps.
- [x] A count out of range fails the job before any source is asked.
- [x] `docs/pipeline.md` says so.
- [ ] Released, and the hosted application runs it.

## Notes

- `packages/pipeline/src/worker/collect.ts`, `runtime.ts`; `docs/pipeline.md`.

## Log

- 2026-11-07T11:38+08:00 — Built. Five collect-step cases, one of them a
  plan of 2 then 1 page reading three posts over two polls, none twice.
  Suite passes (2863 tests), typecheck and lint pass. Not released.
