---
id: US-146
title: A trial may make three projects, and the fuse forgets nothing
type: feature
priority: p1
created: 2026-09-15T23:05+08:00
parent: US-134
area: core
resolution: shipped
---

## Context

**The owner asked what a trial could do by deleting and creating without
end.** US-145 put a Delete button on the projects screen. On the trial, a
delete takes the one monitor with it and frees the one slot, a new monitor has
no `last_polled_at`, and the scheduler ticks every minute — so every cycle was
an immediate poll of four queries on the instance's keys plus the classifier
on what came back, however the daily floor was set. Each cycle is cents; a
loop of them is not.

**Two backstops, and one of them leaked.** The trial ends in seven days. The
account fuse (US-129) sums the month's spend on our keys and pauses the account
at $25 — but `api_usage.monitor_id` cascaded on delete, so every cycle erased
the provider half of what the fuse had counted. Only the model half, in
`model_calls`, survived.

**The owner's decision.** A trial is held to three projects in total, deleted
ones counted. A subscribed account on our keys is held by the $25 fuse. For
the second to be true across deletes, `api_usage` must keep its rows. Not
`set null`: the table's unique key has `nullsNotDistinct` so that one day's
cost tests share a row, and two monitors deleted on one day would have
collided in it. The foreign key goes instead, and the row keeps the id of the
monitor that spent it.

**The count needs a ledger.** A deleted project is gone from `projects`, so
`project_creations` records every creation and is never deleted from. The
capacity carries `projectCreations` (three on the trial, null on the plan),
the create route refuses the fourth with the total, the list route says how
many were made so the delete dialog can say how many are left, and the billing
page lists the total.

## Acceptance

- [x] `api_usage.monitor_id` is no longer a foreign key, so a row outlives its
      monitor, and the fuse test proves a deleted monitor's spend still counts
- [x] `project_creations` gets a row in the same transaction as the project,
      and `countProjectCreations` does not drop when a project is deleted
- [x] The trial capacity carries three creations and the plan none; both are
      readable from `KEYS_INCLUDED_[TRIAL_]PROJECT_CREATIONS`
- [x] A trial's fourth `POST /api/projects` answers 422 with the total, with
      nothing held; the list answers the same sentence and the count
- [x] The delete dialog says how many more projects can be made, and the
      billing page lists the total
- [x] One migration, named in the journal, and `docs/billing.md` and
      `.env.example` say the rule

## Notes

The first poll of a new monitor is still immediate. A person who waits a day
for a first result leaves; the count and the fuse are the bounds, not the
interval.

## Log

- 2026-09-15T23:35+08:00 — Built with US-145 in the same session. Migration
  `0065_a_trial_counts_the_projects_it_made`. Not rendered in a browser.
