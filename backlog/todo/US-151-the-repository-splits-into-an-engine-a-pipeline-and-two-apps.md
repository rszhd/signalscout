---
id: US-151
title: The repository splits into an engine, a pipeline and two apps
type: chore
priority: p1
created: 2026-09-16T13:45+08:00
parent:
area: architecture
resolution:
---

## Context

**The owner decided on 2026-09-16 that the cloud version becomes a separate,
private product.** The open-source repository stays the whole, transparent
application: every capability on, every number shown. The cloud version is
optimised for simplicity and stays experimental for good: it will try
different ways of converting a visitor, different plans, different onboarding.
Both are built on one shared, open-source core, and each has its own REST API,
its own database and its own frontend.

**This reverses one settled line.** STACK.md, *Hosted version*, says
"identical images for self-hosted and hosted means one set of bugs". That was
right while the cloud was the same image with `BILLING_MODE=on`. It is wrong
once the cloud is a product that changes its screens weekly and the
open-source app does not. The line is updated in US-153, not deleted, so the
next reader learns why it changed.

**"A stateless core" is not what `packages/core` is today.** It holds 135
source files, and 79 of them touch Postgres. It is two things in one folder:

* Connectors, model calls, the pre-filter, the estimate, the classification
  schema and the cipher — about 50 files, and almost none touch the database.
  Input in, result and cost out. This is the stateless part.
* The worker, monitors, matches, cursors, the budget guard, deletion
  reconciliation, secrets, auth, billing, admin — the rest. Stateful by
  nature.

**The stateful half cannot be left to each app.** The budget guard, cursor
and deduplication, and deletion reconciliation are the correctness-critical
surfaces named in AGENTS.md. They need tables. If the core is stateless and
each app owns its own tables, the private cloud repo writes those three again,
without the tests. A second budget guard is the one copy that costs money at
02:00. So the split has three layers, not two:

1. **`@signalscout/engine`** — stateless. Connectors, model calls, filter,
   estimate, classification vocabulary, cipher. Keys are arguments. It
   imports no `pg`, no `drizzle-orm`, no `pg-boss`, no `better-auth`, no
   `stripe`, and reads no `process.env`. A boundary test says so to CI, the
   way `core-boundary.test.ts` does for Fastify and React today.
2. **`@signalscout/pipeline`** — stateful, but owns only its own tables:
   monitors, posts, matches, cursors, usage, budget, filter drops. It takes a
   connection and an opaque `account_id`. It runs the poll, classify and
   reconcile jobs through `pg-boss`. Its migrations are its own.
3. **Two apps.** Each has its own API, frontend, auth, migrations and tables
   for accounts, plans, onboarding and experiments. Each composes engine and
   pipeline. The open-source app is this repository. The cloud app is a
   private repository that pins published npm versions of both packages.

**Stripe leaves this repository.** Billing, the paywall and the trial move to
the cloud repo. `BILLING_MODE` goes away, because the open-source app has no
billing to switch off. The default "every setting is the self-hosted answer"
still holds; there is one setting fewer to get wrong.

**The frontend is written twice, on purpose.** The cloud screens are the
experiment. Shared screens can become a third package later if the two
converge. Nothing here plans for it.

**Both packages are public and published.** The cloud repo depends on a
version, not on a git URL. A git dependency rebuilds on every install and
hides which version is live.

## Acceptance

- [x] US-152 shipped: `packages/engine` exists, its boundary test runs in CI,
      and `pnpm test` is as green as before.
- [x] US-153 shipped: `packages/pipeline` is what `core` became; auth, admin,
      feedback and billing are out of it; STACK.md and AGENTS.md say the new
      rule.
- [x] US-154 shipped: `@signalscout/engine` and `@signalscout/pipeline` are on
      npm with a version, from CI.
- [ ] US-155 shipped: the private cloud repo runs against the published
      packages, and the Stripe code is gone from here.
- [ ] `docs/history.md` records the decision with the date and the reason.

## Notes

* The four steps are ordered. US-152 is safe alone and changes nothing that
  runs. Each later one depends on the one before.
* Counted on 2026-09-16: 135 non-test source files in `packages/core/src`,
  79 importing `db/`, `drizzle-orm` or calling the client.
* `backlog/README.md`, *Standing decisions*: "Self-hostable first. The
  open-source build is the whole application. Nothing is removed to make the
  hosted version worth paying for." This split keeps that. What moves out is
  the paywall, which the open-source build never used.

## Log

- 2026-09-16T13:45+08:00 — Written from the owner's decision and a count of
  the import graph. Split into US-152 to US-155.
- 2026-09-16T17:58+08:00 — US-152, US-153 and US-154 shipped; v0.1.0 is on npm. US-155 is what is left, and it needs the private repository made first.
