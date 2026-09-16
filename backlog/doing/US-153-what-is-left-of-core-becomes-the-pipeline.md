---
id: US-153
title: What is left of core becomes the pipeline
type: chore
priority: p1
created: 2026-09-16T13:47+08:00
parent: US-151
area: architecture
resolution:
---

## Context

**After US-152, `packages/core` holds the stateful half.** The worker, the
schedule, cursors and continuations, deduplication, deletion reconciliation,
the budget guard, monitors, projects, matches, usage rows, credentials and
AI keys, notifications — and beside them four things that are not a pipeline
at all: auth, billing, admin and feedback. This ticket renames the package
to `@signalscout/pipeline`, pushes the four out into `apps/api`, and draws
the line the cloud repo will build on.

**The pipeline owns its tables and nothing else's.** Every pipeline table
already names its owner as `user_id text`, with no foreign key to `users`.
That stays, and it is now the rule: the pipeline takes an opaque owner id
and never joins the users table. An app that wants the foreign key adds it
in its own migration. The tables that leave with auth and billing are
`users`, `sessions`, `accounts`, `verifications`, `subscriptions` and
`user_onboarding`. They are Better Auth's and Stripe's, and the open-source
app keeps the first four; the cloud repo gets its own copies of all six.

**Two migration streams, one database.** The pipeline's migrations stay in
`packages/pipeline/drizzle` under their own journal and their own
`drizzle_migrations` table name. The app's migrations start a new stream
under `apps/api/drizzle`. Drizzle supports a `migrationsTable` per stream.
Both run at boot, pipeline first. `db/migrations.test.ts` runs for each
stream. The cloud repo runs the pipeline stream from the published package
and its own stream beside it.

**Entitlement becomes an argument.** `worker/schedule.ts` imports
`entitledCondition` from `billing` to decide which monitors may poll. That
is the half of billing AGENTS.md calls the one that matters, and it cannot
leave with Stripe. So the scheduler takes a gate: a function from an owner
id set to the subset that may poll, run once per tick, before any poll is
enqueued. The open-source app passes a gate that admits everyone. The cloud
app passes one that reads its subscriptions table. The correctness-critical
test for entitlement moves to the gate's contract: a gate that refuses an
owner is never asked to poll for them, and a gate that throws enqueues
nothing.

**Auth is an app concern and every app has it.** `auth/` moves to `apps/api`
whole, with `AUTH_SIGNUP` and `AUTH_EMAIL_VERIFICATION` and their defaults
unchanged. The session gate stays correctness-critical where it lands.

**`BILLING_MODE` goes away in US-155, not here.** This ticket moves
`billing/` to `apps/api`; the code still works; the cloud still runs from
this repo until US-155 cuts it over. Removing it here would leave the cloud
deployment with no paywall for the time between the two tickets.

**The testing harness is exported.** `packages/core/src/testing` — a
database per test file, the network guard — is what every consumer's tests
need, including the cloud repo's. It stays in the pipeline as the `/testing`
export.

**STACK.md and AGENTS.md change.** STACK.md, *Hosted version*: the line
about identical images is replaced by why the cloud is now a separate app
on the same packages. AGENTS.md: the rule about `packages/core` names three
things — engine imports nothing stateful, pipeline imports neither Fastify
nor React, and neither imports an app.

## Acceptance

- [ ] `packages/core` is renamed to `packages/pipeline` by `git mv`; the
      package name is `@signalscout/pipeline`; no file anywhere imports
      `@signalscout/core`.
- [ ] `auth/`, `billing/`, `admin/` and `feedback/` are under `apps/api/src`
      with their tests, and the six tables named above are defined in
      `apps/api`'s schema, not the pipeline's.
- [ ] `apps/api/drizzle` has its own journal and migrations table; both
      streams apply at boot on an empty database and on a copy of the main
      database; `migrations.test.ts` covers both.
- [ ] The scheduler takes an entitlement gate and imports nothing from
      billing. Three test cases: a gate that admits all, a gate that refuses
      one owner, a gate that throws.
- [ ] `apps/api` passes a gate built from `BILLING_MODE`, and
      `billing.test.ts` still proves that an account past its trial does not
      poll.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
      `docker compose build` pass; the image starts and answers `/health`.
- [ ] Every `live:*` and `capture:*` command in AGENTS.md still names a
      command that exists, in the package that now owns the file.
- [ ] STACK.md, *Hosted version* and AGENTS.md, *Rules that are easy to
      break* say the new rule; `docs/testing.md` names the two migration
      streams.

## Notes

* `packages/core/src/worker/schedule.ts:16` and `:80` — the entitlement
  read to replace.
* `packages/core/src/worker/runtime.ts:163` — `billing?: BillingMode` on
  the worker options; becomes the gate.
* `packages/core/src/db/schema.ts` — 30 tables; six leave.
* `scripts/new-worktree.mjs` copies the database and pauses every monitor;
  check it still finds the monitors table after the rename.

## Log

- 2026-09-16T13:47+08:00 — Written as step two of US-151.
