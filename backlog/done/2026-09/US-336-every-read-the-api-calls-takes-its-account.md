---
id: US-336
issue: 84
title: Every read the API calls takes its account
type: chore
priority: p2
created: 2026-09-23T06:46+08:00
parent:
area: api
resolution: shipped
---

## Context

AGENTS.md says that scoping a route means scoping every read in it, and
BUG-009 is the incident behind the rule. Today the rule is kept by review: a
route checks ownership in its own way, with `ownedMonitor`, a `userId`
argument, or a join, and nothing fails when a new route forgets.

A rule that only review keeps is broken on the day review is tired. The
boundary tests already show the better shape: `engine-boundary.test.ts`
makes a package rule a failing test.

## Acceptance

- [x] Every function in `packages/pipeline` that `apps/api` calls to read or
      change an account's rows takes the user id as an argument, and filters
      on it.
- [x] A boundary test fails when such a function has no user id argument, and
      lists the ones that are deliberately instance-wide with the reason.
- [x] Every route has a test that a second account gets 404 or an empty
      answer.

## Notes

- Do this after the open security fixes land.
- `apps/api/src/auth.ts`, `ownedMonitor`, is the current helper.
- AGENTS.md, *Scoping a route means scoping every read in it*.

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
- 2026-09-23T07:15+08:00 — **Started, on the private security chain, and stopped at a
  decision.** `auth.test.ts` now walks every registered route that names a
  record (`:id` on monitors, matches, projects, reply prompts and cost
  tests), asks it as a second account with the owner's real ids, and checks
  that each answers 400 or above, shows none of the owner's text, and changes
  none of the owner's rows. It found BUG-330's route when run against the old
  code, so it would have caught that bug on the day it was written.

  **The first two boxes wait for the owner.** 51 of the 77 pipeline functions
  the API calls with the database already take the user. Of the other 26,
  some are instance-wide on purpose (the boot checks, `lastCollections`,
  the counts that take a list of monitor ids from the caller), and twelve
  address one monitor by id and rely on the route's `ownedMonitor`:
  `getMonitor`, `updateMonitor`, `pauseMonitor`, `resumeMonitor`,
  `deleteMonitor`, `getBudget`, `setBudget`, `clearBudget`,
  `checkBudget`, `readNotificationSettings`, `saveNotificationSettings`
  and `matchOwner`. Giving those twelve a user id changes twelve exports of
  `@signalscout/pipeline` that the hosted application calls, which is a
  breaking change the owner should choose. The sweep holds the rule by
  behaviour in the meantime.

  The third box is half done: every route with an id is covered, the list
  routes are not all.
- 2026-09-23T15:30+08:00 — **Done, by the owner's choice: a twin beside each of
  the twelve, not a changed signature.** The worker calls `getMonitor` and
  `checkBudget` with no account, because it polls every account, so a
  required user id did not fit those callers. The twins take `userId` after
  the database, as `readOwnedEstimate` did in 0.14.0, and answer a stranger
  what the unchecked function answers for an unknown id. Nothing is removed,
  so the hosted application moves when it chooses.

  `account-boundary.test.ts` reads the API's imports from the pipeline and
  each function's parameters, as text: the TypeScript 7 compiler API is
  marked unstable. 70 functions take the database; 60 take the account, or
  an input type that requires one. The other ten are listed with a reason:
  two boot checks, four counts over ids the caller passes, three reads of
  every monitor that the route narrows (US-333), and `refuseEstimate` on the
  row the same request made. The first box is true of every function that
  addresses one record; those ten read past one account by design, which is
  what the second box allows.

  The sweep for routes without an id asks all 15 GET routes as a stranger
  while the owner has one of everything and a spend no other row adds up to.
  The owner, asking the same routes, sees their text on at least five, so an
  absence is a refusal.

  Each test was shown to fail: an owner check that always says yes fails ten
  of the thirteen package cases, an unchecked import in `estimates.ts` fails
  the boundary test by name, and a monitor list read for the wrong account
  fails the sweep at `GET /api/monitors`. Full suite: 141 files, 2,400 tests.

  Not reached by the boundary test: `projects.ts` and `leads.ts` query the
  pipeline's tables directly. Both filter on the account today.
