---
id: US-265
title: The inbox and the monitor page say which stage runs now
type: feature
priority: p2
created: 2026-09-20T09:03+08:00
parent:
area: web
resolution: shipped
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

- [x] `GET /api/monitors` and `GET /api/monitors/:id` carry a `stage`: the
      queue, `active` or `queued`, since when, and the item count when the
      job holds one.
- [x] The read answers `null` when `pgboss.job` does not exist; a test
      proves it against a database the worker never touched.
- [x] A test scopes the read: a job for another account's monitor is not
      reported.
- [x] The inbox has one bar at the top: what the monitoring is doing now,
      when it runs again if waiting, and what the last poll did.
- [x] *Current activity* on the monitor page uses the same rule and says
      *Waiting* when nothing runs; the last poll moves to the supporting line.
      The waiting words are the rule's: "Next poll in 30 minutes", "Waiting
      for the first poll", "Paused — nothing is collected until it is
      resumed", "No more polls this month".
- [x] The monitor list marks a monitor whose stage is running.
- [x] Both screens refresh faster while a stage runs and slower while
      waiting; the two intervals are named once.
- [x] `apps/api/src/monitors.ts` is split by route group before the stage
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
- 2026-09-20T10:05+08:00 — Split `monitors.ts` into `monitors/` by route
  group, bodies unchanged, in its own commit.
- 2026-09-20T10:40+08:00 — Shipped. `apps/api/src/activity.ts` reads
  `pgboss.job` in one statement for a list of ids and answers an empty map
  on any failure; `activity.test.ts` drives it through the real `pg-boss`
  (12 cases, one through the routes as a stranger) and once against a
  database the worker never touched. `pg-boss` is a dev dependency of the
  API for that file. `monitor.tsx` holds `monitoringState`, `stageLabel`,
  `stageOf`, `useMonitorRefresh`, `anyWorking` and the two intervals; the
  inbox bar, the monitor page headline and the list's stage line all read
  it. One assertion changed on purpose: a monitor that never polled reads
  "Waiting for the first poll" and no longer "This monitor has not polled
  yet." Mutations: intervals swapped, a queued stage counted as working,
  the headline showing the last poll, the list never speeding up — each
  went red under its case. 380 web and 340 API tests pass. No browser has
  rendered the bar.
