---
id: US-007
title: The worker runs jobs on a schedule
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

A monitor is a thing that runs on its own. Without a scheduler the product is
a search box, and PLAN.md is explicit that it is not one.

STACK.md chose `pg-boss`, which stores jobs in Postgres tables. Debugging a
stuck job is a `SELECT`, and there is no second service for a self-hoster to
run or back up.

The pipeline from PLAN.md is a chain of four jobs, not one long job:

    poll → pre-filter → classify → notify

They are separate because they fail differently and cost differently. A model
API that is down should not make the poll re-fetch posts that were already
paid for. A retry of the classify step must never re-run the poll step.

Poll frequency is a cost dial, not a performance dial. An X read costs money,
so the interval is per monitor and settable, and `pg-boss` throttling holds it.

Two failure modes deserve care now. A job that throws forever must land in a
dead letter queue and stop, not retry until the account is drained. And two
workers must never poll the same monitor at the same time, which is a
singleton key, not a lock the code writes itself.

## Acceptance

- [ ] `pg-boss` runs its own migrations against the same Postgres
- [ ] Four job types exist and can be enqueued and run independently
- [ ] A failed job retries with a backoff and stops in a dead letter queue
      after a bounded number of attempts
- [ ] A retry of one step does not re-run the step before it
- [ ] Two worker processes running at once do not poll the same monitor twice
- [ ] Each monitor has its own poll interval, and it is read from the database
      rather than a constant
- [ ] The worker runs both in-process and as a separate process, per
      `WORKER_IN_PROCESS`, with no code change
- [ ] A shutdown signal lets running jobs finish before the process exits
- [ ] Every job logs its monitor id, duration and outcome through `pino`

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- STACK.md, *Not Redis*, for why this is a library and not a service.
- A stuck queue is inspected with `SELECT * FROM pgboss.job`. Say so in the
  self-hosting documentation; it is the first thing anyone will need.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
