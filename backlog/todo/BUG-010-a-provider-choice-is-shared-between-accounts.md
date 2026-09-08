---
id: BUG-010
title: A provider choice is shared between accounts
type: bug
priority: p1
created: 2026-09-08T11:25+08:00
parent: US-067
area:
resolution:
---

## Context

Found while fixing [BUG-009](../done/2026-09/BUG-009-the-providers-page-answers-for-the-instance.md),
and left unfixed because it is a different table and a different decision.

`source_providers` is keyed by `source` alone — one row per platform, for the
whole instance. US-026 made it that way on purpose: *"The choice is global, not
per monitor. A person who wants Reddit through Bright Data wants it for every
monitor."* That sentence is true of one person and false of two.

On an instance with `AUTH_SIGNUP=open`, one account setting Reddit to
ScrapeCreators changes which provider **every other account** polls through. It
is worse than a shared preference, because of US-026's own rule: *"a recorded
choice that cannot run is refused rather than replaced."* So an account that
picks a provider it holds a key for can stop another account's monitors dead —
that account holds a different key, its choice can no longer run, and its polls
are refused rather than falling back.

The self-hosted instance is unaffected. One account, one choice, and this is
exactly the shape US-026 built.

## Acceptance

- [ ] `source_providers` carries `user_id`, in its primary key, and a migration
      backfills existing rows to the first account
- [ ] A poll reads the choice of the monitor's owner
- [ ] One account's choice never changes what another account polls through,
      asserted against real Postgres with two accounts
- [ ] A collection already running still resumes through the provider that
      started it, whoever changed a choice meanwhile — US-026's rule, unbroken
- [ ] The providers screen sets and clears only the signed-in person's choice

## Notes

- Five readers of `readProviderChoices`: collect, replies, estimate, reconcile
  and the pricing route. Each has an owner in scope already, the same way
  US-067's credential lookup does.
- `source_continuations` already carries the provider that started a
  collection, so the in-flight case needs no new column — only a test that says
  it still holds.
- Read STACK.md, *A source is not a provider*, and US-026 before changing the
  rule rather than the scope.

## Log

- 2026-09-08T11:25+08:00 — Written while fixing BUG-009. Same class, different
  table, and the consequence is worse: BUG-009 showed somebody the wrong
  numbers, this one can stop their monitors.
