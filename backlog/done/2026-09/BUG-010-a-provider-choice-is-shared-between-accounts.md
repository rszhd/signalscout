---
id: BUG-010
title: A provider choice is shared between accounts
type: bug
priority: p1
created: 2026-09-08T11:25+08:00
parent: US-067
area:
resolution: fixed
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

- [x] `source_providers` carries `user_id`, in its primary key, and a migration
      backfills existing rows to the first account
- [x] A poll reads the choice of the monitor's owner
- [x] One account's choice never changes what another account polls through,
      asserted against real Postgres with two accounts
- [x] A collection already running still resumes through the provider that
      started it, whoever changed a choice meanwhile — US-026's rule, unbroken
- [x] The providers screen sets and clears only the signed-in person's choice

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
- 2026-09-10T02:52+08:00 — Fixed, ahead of opening the production instance to
  registrations. `source_providers` is keyed by `(user_id, source)`, migration
  0055 backfills every existing row to the first account, and all three
  functions in `choices.ts` take the owner. **The signature is what covers the
  readers no test reaches**: the table cannot be read without answering whose
  choice it is, and the compiler enumerated all eight call sites rather than a
  grep doing it.

  **`reconcile` was the one reader that could not simply be threaded.** The
  other four hold one monitor and so one owner; that job walks a page of
  matches which may belong to different people, so a single read above the loop
  would have been this same bug living inside the fix. It reads per owner now,
  cached for the length of the job.

  **Removing the fix in four places turns the suite red**: the read ignoring
  the owner (6 tests), the delete ignoring it (3), `reconcile` reading a
  neighbour's row (1), and the claim dropped from `claimUnownedRows` (1). The
  third of those *passed* on the first attempt and the test was written for
  it — the existing switch case asserts the continuation wins, which it does
  whoever the choices belong to.

  **One rule was switched back on rather than merely rescoped.** US-090's
  "a stored key records the choice for a platform nothing else fetches" did not
  run where signup was open, and the reason it gave was this table being
  shared. The row is the saver's own now, so the guard is gone and its test
  asserts the opposite of what it asserted this morning.

  `claimUnownedRows` gained the table for a sharper reason than the four rows
  already there. Those are screens going empty, which reads as data loss; this
  one is silent — a pre-login choice left under `self-hosted` means the first
  account polls as though it chose nothing, and a box holding two Reddit keys
  refuses every Reddit collection with nothing on any screen to say why.

  Migration 0055 was rehearsed against the development database: three rows,
  all kept, all re-pointed to the first account, and the new composite key in
  place. 1,773 tests pass.

  **Nothing here has run live.** No instance has yet taken a second
  registration with two Reddit keys on it, so the fault this closes has never
  been observed in production and neither has its absence.
