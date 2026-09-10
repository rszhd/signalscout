---
id: US-105
title: Onboarding is for new accounts only
type: feature
priority: p1
created: 2026-09-10T12:00+08:00
parent: US-088
area: web
resolution:
---

## Context

**Removing every key sends an existing account back to setup.** US-088 decides
whether to show the setup screen by deriving it from the keys alone: if no
provider key is ready and no model key is ready, `App.tsx` replaces the whole
application with `Onboarding`. That is correct for an account that has never set
up. It is wrong for an account that set up months ago and has just removed its
last key: the product forgets the account was ever configured, and the person
meets a page written for a stranger.

**US-088 chose derivation over a flag, and this reverses that one decision.**
The ticket said a stored flag "would go wrong in the direction that hurts — an
account that deleted its keys would be told it is set up". That is the opposite
of what the owner wants. An account that removed its keys is not a new account,
and the product should let it in; the monitor form and every poll already refuse
it with a reason. The flag's failure direction is the safe one here.

**What is recorded is completion, not key state.** One row per account, written
the first time the account holds both keys, and never deleted. The gate then
asks two questions: is this account new, and are its keys missing. It shows only
when the answer to both is yes.

**The write is the client's, because the client already computes the
condition.** The gate's own test — any provider ready, and the scoring job able
to run — is computed in `App.tsx` from `/api/connections` and `/api/models`, and
it accounts for keys stored on the account and keys in the instance's
environment. A server-side copy of that rule would be a second answer that can
disagree with the first. The gate is not a security boundary, so a client write
is acceptable; the route is idempotent and a failed write is retried on the next
load.

**Every account that exists when the migration runs is marked complete.** There
is no earlier record to read, and none of those accounts is new: the instance
was running and somebody was using it. On a fresh database the backfill inserts
nothing, so the first account of a new install still sees the gate.

## Acceptance

- [x] A table records that an account completed onboarding, one row per account,
      written once and never deleted.
- [x] `/api/auth-status` answers `onboarded` for the signed-in account.
- [x] `PUT /api/onboarding` marks the signed-in account complete; a second call
      changes nothing.
- [x] The setup gate shows only when the account is not onboarded and a key is
      missing.
- [x] An account that completed onboarding is never sent back to setup after it
      removes every key.
- [x] A brand-new account still sees setup until both keys are present.
- [x] A failed setup read still opens the gate rather than locking the account
      out.
- [x] The migration marks every account that existed before it, and a fresh
      database is unaffected.
- [x] The suite, lint, typecheck and build are clean.

## Notes

No key is deleted and no other behaviour changes. The marker is one boolean
fact about an account, and nothing reads it but the gate.

The migration backfill is the only irreversible part. It is written as a single
`INSERT ... SELECT` over `users`, and it ran against the development database
in the ticket's Log.

## Log

- 2026-09-10T12:00+08:00 — Written.
- 2026-09-10T13:20+08:00 — Done. `user_onboarding` is one row per account,
  written by `markOnboardingComplete` and read by `hasCompletedOnboarding` in
  `packages/core/src/auth/onboarding.ts`. Migration
  `0057_onboarding_is_recorded_once` creates it and backfills every account that
  existed before it. `/api/auth-status` gained `onboarded`, `PUT
  /api/onboarding` writes the marker, and `App.tsx` gates only when the account
  is not onboarded and a key is missing.

  **The write is the client's.** The gate's condition — any provider ready and
  the scoring job able to run — is already computed in `App.tsx` from
  `/api/connections` and `/api/models`, and it counts keys stored on the account
  and keys in the environment alike. A server copy would be a second answer that
  can disagree with the first. The gate is not a security boundary; the route is
  idempotent and a failed call is retried on the next load.

  **The backfill ran on the development database.** Before it there were 5
  accounts and 0 markers; after it 5 and 5. The test databases are built from an
  empty database, so a fresh install inserts nothing and the first account still
  meets the gate.

  Tests: 4 in `packages/core/src/auth/onboarding.test.ts`, 2 in
  `apps/api/src/onboarding.test.ts`, and 3 in `App.test.tsx` — an onboarded
  account with no keys is not gated, the marker is written once both keys are
  present, and it is not written for an account that already finished. Lint,
  typecheck and `pnpm build` are clean.

  The full suite is 1,829 passed and 1 failed. The one failure is
  `collect.test.ts`'s "stores one row when a poll finds the same post twice", a
  test in this working tree for the unwritten BUG-015: Postgres refuses one
  `INSERT` whose own rows collide on `(source, external_id)`. It is unrelated to
  this change and is the owner's in-progress work.

  Unproven: no real browser has rendered the gate after the change, and no live
  poll or key removal has run against a migrated instance. The migration's
  backfill is the only part that touched real rows.

