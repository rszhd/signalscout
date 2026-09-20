---
id: US-265
title: The inbox and the monitor page say which stage runs now
type: feature
priority: p2
created: 2026-09-20T09:03+08:00
parent:
area: web
resolution:
---

## Context

The inbox is the screen a person keeps open, and it says nothing about
whether collection is running. An empty inbox has two readings, nobody is
talking or the monitor is paused, out of budget or failing, and the person
has to open the monitor page to tell them apart.

The monitor page's *Current activity* is not current either. It shows the
last poll, which is the section directly below it. A poll is the first of
five stages: poll, filter, replies, classify, notify. The classifier is the
slow half and where the money goes, so the minutes after a poll finishes are
the minutes the page describes as "Next poll in 6 hours" while the work that
fills the inbox is still running.

The stage is already in the database. The pipeline is five `pg-boss` queues,
and every job carries its monitor id. A job row that is `active` is the stage
running now; `created` or `retry` is the one about to. The queue names come
from `pipelineQueues` in the package, never from a string written here. The
job table belongs to `pg-boss` and is created by the worker, so an API that
boots first must answer "no stage" rather than 500.

One rule, in one place. The status words come from `monitor.tsx`; a status
computed twice becomes two statuses the first time one is edited, and "Found
nothing" on the monitor page beside "Running" in the inbox is the failure
US-104 exists to prevent.

The hosted application built this as US-198, US-199 and BUG-020 there. Its
`apps/api/src/activity.ts` is the read and its `monitoringState` in
`monitor.tsx` is the rule; both are named here so the shape is copied and
not reinvented.

## Acceptance

- [ ] `GET /api/monitors` and `GET /api/monitors/:id` carry a `stage`: the
      queue, `active` or `queued`, since when, and the item count when the
      job holds one.
- [ ] The read answers `null` when `pgboss.job` does not exist; a test
      proves it against a database the worker never touched.
- [ ] A test scopes the read: a job for another account's monitor is not
      reported.
- [ ] The inbox has one bar at the top: what the monitoring is doing now,
      when it runs again if waiting, and what the last poll did.
- [ ] *Current activity* on the monitor page uses the same rule and says
      *Waiting* when nothing runs; the last poll moves to the supporting line.
- [ ] The monitor list marks a monitor whose stage is running.
- [ ] Both screens refresh faster while a stage runs and slower while
      waiting; the two intervals are named once.
- [ ] `apps/api/src/monitors.ts` is split by route group before the stage
      route is added, so it does not pass 1,300 lines.

## Notes

- `packages/pipeline/src/index.ts:410` — `pipelineQueues`.
- `apps/web/src/monitor.tsx:204` — `status()`, the rule to extend.
- `apps/web/src/MonitorDetail.tsx:445` — *Current activity*.
- Cloud repository: `apps/api/src/activity.ts`, `apps/web/src/monitor.tsx`
  (`monitoringState`, `useMonitorRefresh`), and US-251 for the route-group
  split.

## Log

- 2026-09-20T09:03+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
