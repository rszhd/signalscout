---
id: US-150
title: A monitor belongs to the keys it was made on
type: feature
priority: p1
created: 2026-09-16T11:30+08:00
parent: US-141
area: core
resolution: shipped
---

## Context

**The owner's rule: a monitor made on the instance's keys does not run on
the account's own, and the reverse.** One made on ours was fitted to the
plan's capacity and priced on the plan; one made on theirs was neither. So a
switch does not carry monitors across. They stay, they stop, and they run
again when the account switches back.

**Stamped at creation, compared at every read.** `monitors.key_source` is
written from the account's state by the create route and never rewritten. The
scheduler compares it with `account_key_source` in SQL and leaves the others
out; the poll refuses one that a job queued a tick earlier still reaches,
with the new stop reason `other_keys`; every monitor read carries
`runsOnCurrentKeys`, and the list and the page show "On other keys" with a
sentence naming where to switch. A monitor made on the account's own keys
fills no slot of the plan's capacity.

**Only where the deployment charges.** A self-hosted instance has no switch,
passes no `keySourceFor`, and every monitor runs as before. Migration 0066
stamps every existing monitor with its account's state at the time.

## Acceptance

- [x] `monitors.key_source` with its check, backfilled from the account's
      state, in one migration named in the journal
- [x] The create route stamps it; the scheduler skips a monitor made on the
      other keys; the poll refuses one with `other_keys`; self-hosted skips
      and refuses nothing
- [x] Capacity counts only monitors made on the instance's keys
- [x] Every monitor read carries `keySource` and `runsOnCurrentKeys`; the
      pill reads "On other keys" and the page says where to switch
- [x] `docs/billing.md` says the rule

## Notes

`platform_not_due` also gained a sentence on the way; it was showing raw.
Not rendered in a browser.

## Log

- 2026-09-16T12:05+08:00 — Shipped. Locally the backfill stamped 32 monitors
  `instance` and 1 `own`.
