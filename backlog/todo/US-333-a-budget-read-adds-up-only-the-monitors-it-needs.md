---
id: US-333
labels: [help wanted, medium]
title: A budget read adds up only the monitors it needs
type: chore
priority: p3
created: 2026-09-23T06:41+08:00
parent:
area: budget
resolution:
---

## Context

`budgetStates` calls `spendByMonitor`, which adds up this month's
`api_usage` and `model_calls` for every monitor on the instance. Two routes
call it for far less:

- `POST /api/matches/:id/draft` needs one monitor's state.
- `GET /api/monitors` needs only the signed-in account's monitors.

`readSpend` already accepts `monitorIds`, and neither caller passes it. On a
development database with 9,335 model calls the query is a sequential scan
of 6.5 ms. That is fine for one person. On the hosted instance it grows with
every account's ledger, on each monitor list and each draft.

## Acceptance

- [ ] `budgetStates` takes the monitor ids it should answer for, and both
      routes pass them.
- [ ] A test shows that a second account's spend does not change the first
      account's states and is not read.
- [ ] The Log records the query plan for one monitor, before and after.

## Notes

- `packages/pipeline/src/budget/budget.ts`: `readSpend`,
  `spendByMonitor`, `budgetStates`.
- `apps/api/src/drafts.ts` and `apps/api/src/monitors/collection.ts`.
- `api_usage_monitor_day_idx` exists; `model_calls` has no index that
  starts with `monitor_id, created_at`, so check the plan before adding one.

## Log

- 2026-09-23T06:41+08:00 — Found in a review of the open repository.
