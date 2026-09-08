---
id: BUG-009
title: The providers page answers for the instance, not the account
type: bug
priority: p1
created: 2026-09-08T11:15+08:00
parent: US-067
area:
resolution: fixed
---

## Context

Reported from a running instance: an account that had just registered and
created nothing was shown match and spend figures on `/providers`. They were
another account's.

US-067 edited this route to scope the *keys* and left three reads beside them
untouched — the spend from `api_usage`, the posts-and-matches from
`providerReturns`, and the verdict count. That is the shape of the whole class:
the obvious half of a file gets fixed, and the numbers underneath keep
answering for the instance. Nothing on the page was scoped by a test, so nothing
went red.

Two of the three were simple. The spend was not, and the reason is worth
keeping: `api_usage.monitor_id` is null for a cost test, which is real money
bought before a monitor exists, so joining through the monitor would have
attributed that spend to nobody and dropped it off every page. The table needed
its own owner.

`posts` is the one that cannot have an owner. A post is deduplicated across
every monitor on the instance, so the same Reddit thread is one row however many
accounts collected it. What *is* per account is what each account's monitors did
with it, so the page now counts the posts an account's monitors matched or
recorded a drop for. On a single-account instance that is the same number as
before, because every collected post is either matched or dropped by the monitor
that collected it.

## Acceptance

- [x] A new account sees zero posts, zero matches, zero spend and zero verdicts
      on `/providers`, with another account's data present
- [x] An account still sees its own figures, unchanged on a single-account
      instance
- [x] `api_usage` records which account spent the money, including for a cost
      test that has no monitor
- [x] A regression test drives both accounts against real Postgres

## Notes

- The provider *choice* is the same class of bug and is **not** fixed here. See
  [BUG-010](../../todo/BUG-010-a-provider-choice-is-shared-between-accounts.md).
- `spendByPair` moved the query into core, where the database is reached.
  `apps/api` imports no `drizzle-orm`, so a query written in the route is a
  query written twice.

## Log

- 2026-09-08T11:15+08:00 — Reported by the owner against their own instance:
  "/providers page shows up statistic of matches for new user when nothing has
  been created yet".
- 2026-09-08T11:18+08:00 — Reproduced as a test before anything was changed: a
  second account saw the first's post, match, spend and verdict. Four numbers,
  all wrong, on the first screen a new person opens.
- 2026-09-08T11:20+08:00 — Migration 0045 adds `api_usage.user_id` and puts it
  in the unique key. That last part matters: the key is `nullsNotDistinct`, so
  without the owner two accounts running a cost test on the same pair on the
  same day would have added their money into one row.
- 2026-09-08T11:22+08:00 — Fixed. 1,412 tests pass. **The lesson is the one
  US-067 should have applied: scoping a route means scoping every read in it,
  and the way to know is to count them.** This route had four and three were
  missed.
