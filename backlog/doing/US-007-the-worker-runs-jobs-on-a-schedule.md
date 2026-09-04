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

- [x] `pg-boss` runs its own migrations against the same Postgres
- [x] Four job types exist and can be enqueued and run independently
- [x] A failed job retries with a backoff and stops in a dead letter queue
      after a bounded number of attempts
- [x] A retry of one step does not re-run the step before it
- [x] Two worker processes running at once do not poll the same monitor twice
- [x] Each monitor has its own poll interval, and it is read from the database
      rather than a constant
- [x] The worker runs both in-process and as a separate process, per
      `WORKER_IN_PROCESS`, with no code change
- [x] A shutdown signal lets running jobs finish before the process exits
- [x] Every job logs its monitor id, duration and outcome through `pino`

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- STACK.md, *Not Redis*, for why this is a library and not a service.
- A stuck queue is inspected with `SELECT * FROM pgboss.job`. The README now
  says so, under *When a monitor stops finding things*, with the four queries
  worth having: state per queue, the dead letter queue, the schedule, and each
  monitor's poll mark.
- Files: `packages/core/src/worker/` holds `queues.ts` (names, payloads, retry
  policy), `schedule.ts` (which monitors are due), `collect.ts` (the poll step),
  `steps.ts` (the step contract and the three placeholders) and `runtime.ts`
  (the wiring).
- The three placeholder steps are wired, logged and chained, and do no work.
  US-008 replaces `passThroughFilter`, US-009 `unimplementedClassify`, US-016
  `unimplementedNotify`. They arrive through `startWorker`'s `steps` option, so
  none of them touches the queue wiring.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
- 2026-09-05 — Built. Notes on the decisions the code cannot hold:

  **The poll queue's policy is `stately`, keyed on the monitor id.** It allows
  one job per state per key: one queued, one retrying, one active. *One active*
  is the rule the ticket asked for. *One queued* is what stops a poll that runs
  longer than its own interval building a backlog of polls that then run back
  to back, each one spending money. `exclusive` was the first choice and is
  wrong: it gives the whole key one row, so a queued follow-up and a retrying
  job compete for it, on the one queue where a dropped retry costs a re-fetch.

  **Migration 0002 adds three columns to `monitors`.**
  `poll_interval_seconds` is the ticket's cost dial, with a floor of 60 seconds
  as a check constraint rather than form validation, because the worker reads
  the column directly. `last_polled_at` is the mark the scheduler measures
  from, written by the poll step at its *start*, so a slow poll does not
  stretch the interval it was given. `sources` says which connectors a monitor
  polls; without it the scheduler has nothing to dispatch. US-010's form fills
  all three.

  **Source keys are read from the environment as `<SOURCE>_<FIELD>**, derived
  from each connector's own `credentialFields`, so adding a connector adds no
  case. This renamed `BRIGHTDATA_API_KEY` to `REDDIT_API_KEY` in `.env.example`,
  the README, PLAN.md and the connector's own error message, and the assertion
  in `reddit.test.ts` moved with it. That is an assertion changing because the
  behaviour was meant to change: STACK.md, *A source is not a provider*, says
  the user connects Reddit and the company serving it is our problem. The
  capture script keeps `BRIGHTDATA_API_KEY`; it authenticates to Bright Data
  by hand and is not the application. US-004 removes all of this from the
  environment.

  **A source with no credentials is skipped and logged, not failed.** A missing
  key is not transient. Failing would retry four times and then bury the one
  sentence the user has to read in the dead letter queue.

  **The mutation pass found one test asserting nothing.** Dropping the
  singleton key from the poll send left the suite green: with a single monitor,
  `stately` dedups on the empty key, so "one poll per monitor" and "one poll
  anywhere" give the same answer — and the second is a scheduler where one slow
  monitor holds up every other. The test now uses two monitors. Nine other
  mutations were caught first time; this is the tenth, and the one worth
  recording.

  **Unproven until it runs somewhere real.** The poll step has still never met
  Bright Data. Every test drives the fake connector with a `fetch` that cannot
  reach anything, so what is proven is our half: the paging, the cap, the
  cursor handling, the wait, the storage and the chaining. A real collection, a
  real snapshot expiry and a real rate limit are all still unproven. The
  scheduler now calls the connector, so the next run against a live key is what
  finds out.
