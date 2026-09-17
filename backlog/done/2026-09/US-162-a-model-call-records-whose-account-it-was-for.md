---
id: US-162
title: A model call records whose account it was for
type: feature
priority: p1
created: 2026-09-17T10:57+08:00
parent:
area: billing
resolution: shipped
---

## Context

The cloud plans put a monthly allowance on an account (cloud US-165). An
allowance needs one number: what this account spent this month, sources and
model together.

`api_usage` carries `user_id`. `model_calls` does not: it carries
`monitor_id`, nullable, and a draft, a query generation and a key test are
written with no monitor at all. Joining through `monitors` would lose exactly
the calls a person presses a button for, and those are the ones a plan
counts (drafts per month).

The per-monitor cap (`budget/budget.ts`) is not touched. It stays the guard a
person sets on one monitor; the account allowance sits above it.

## Acceptance

- [x] `model_calls.user_id` exists, is written on every insert, and is
      backfilled from `monitors.user_id` where a monitor is known. Rows with
      neither stay null and are counted by nobody, which the migration says.
- [x] `accountSpend(db, userId, now)` — the clock, like `monitorSpend` takes,
      and the month start is derived — is exported from the pipeline
      and answers `{ sourceMicros, modelMicros, totalMicros }` for one
      account and one calendar month, from both tables, in one round trip.
- [x] `draftsThisMonth(db, userId, now)` counts `model_calls` rows
      with purpose `draft_reply` for the account, so a plan's draft limit is
      one query rather than a second ledger.
- [x] The migration is named in `meta/_journal.json`.
- [x] `docs/accounts.md`, *Locked out*, lists `model_calls` in the tables an
      operator moves between accounts.

## Notes

- `packages/pipeline/src/db/schema.ts`, `modelCalls` near line 918; the
  writers are under `packages/pipeline/src/worker/` and the drafts route.
- `monitorSpend` in `budget/budget.ts` is the shape to copy.

## Log

- 2026-09-17T10:57+08:00 — Written from the cloud costing study.
- 2026-09-17T11:35+08:00 — Built. `user_id` on `model_calls` with an index
  on `(user_id, created_at)`; migration 0060 adds it and backfills from
  `monitors`. `recordModelCall` requires `userId` — one writer, seven
  callers, and the type checker named every one. The worker passes the
  monitor's owner; each route passes the session's. `accountSpend` is one
  statement with two scalar subqueries; `draftsThisMonth` counts every
  outcome, so a failing model cannot hand out unlimited attempts.
- 2026-09-17T11:40+08:00 — 114 files, 2065 tests pass; typecheck, lint and
  build pass. Four new cases: both ledgers on and off a monitor, another
  account and last month excluded, a null owner counted by nobody and an
  unpriced call as nothing, and the draft count. The backfill has run only
  against the suite's empty databases; it meets a real ledger on the first
  deploy.
