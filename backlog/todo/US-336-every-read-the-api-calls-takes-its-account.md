---
id: US-336
title: Every read the API calls takes its account
type: chore
priority: p2
created: 2026-09-23T06:46+08:00
parent:
area: api
resolution:
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

- [ ] Every function in `packages/pipeline` that `apps/api` calls to read or
      change an account's rows takes the user id as an argument, and filters
      on it.
- [ ] A boundary test fails when such a function has no user id argument, and
      lists the ones that are deliberately instance-wide with the reason.
- [ ] Every route has a test that a second account gets 404 or an empty
      answer.

## Notes

- Do this after the open security fixes land.
- `apps/api/src/auth.ts`, `ownedMonitor`, is the current helper.
- AGENTS.md, *Scoping a route means scoping every read in it*.

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
