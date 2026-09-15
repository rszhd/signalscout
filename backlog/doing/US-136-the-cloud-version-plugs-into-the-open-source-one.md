---
id: US-136
title: The cloud version plugs into the open-source one
type: chore
priority: p1
created: 2026-09-15T21:45+08:00
parent:
area:
resolution:
---

## Context

**This repository is public, and the hosted product is not all of it.** The
landing page, the admin panel and everything Stripe belong to one deployment:
the cloud one. They ship in the public image today because there is nowhere
else for them to go. The owner decided on 2026-09-15 that they move to a
private repository, `signalscout-cloud`, and that the public repository holds
the core only. The `ee/`-folder shape — cloud code in this repository under
its own license — was offered and refused.

**The private repository composes this one; it does not call it.** A REST
boundary between the two was considered and refused. The half of billing that
costs money is inside the scheduler (`findDueMonitors` must not return an
unpaid owner's monitors) and inside a Fastify `onRequest` hook over every write
route. A network call at those two points is a second service, a second way to
fail at 02:00 and latency on every write. The cloud code must run in the same
process, so the boundary is a package boundary: the private repository takes
this one as a git submodule at `upstream/`, lists `upstream/packages/*` and
`upstream/apps/*` in its own `pnpm-workspace.yaml`, and depends on
`@signalscout/core` with `workspace:*`. No npm publishing and no version
drift: the private repository pins one public commit and moves it when it
chooses.

**The seams mostly exist; this ticket makes them a contract.** `BillingProvider`
is already an interface and `createStripeBilling` the only Stripe constructor.
`BILLING_MODE=off` already makes every hook a no-op. What is missing is a way
for code outside this repository to be handed those seams: a plugin list for
the API, an entitlement rule for the scheduler, a sign-up hook for the trial,
and slots in the web `App` for a route, a nav item and a banner. Each has a
default that is the self-hosted answer, so a self-hoster who never sets a
variable sees nothing change.

**The `subscriptions` table and the entitlement rule stay here.** Two reasons.
The migrator walks one journal, and a table owned by the private repository
would need a second migration source — real work, and a new way to break at
boot. And entitlement is on the correctness-critical list: the tests that
prove the scheduler refuses an unpaid account should run in the public suite,
where every contributor runs them. Only the payment provider moves — Stripe,
the webhook, Checkout, the portal and the billing screen. A subscription status
with no provider behind it is a generic concept an admin could set by hand.

**One cost, named.** STACK.md says identical images for self-hosted and hosted
mean one set of bugs. This keeps most of that — the hosted image is the public
packages plus plugins, built from one pinned commit — and not all of it. The
private `main.tsx` and the private server entry can drift. Keep both entries
small, and keep every test for the public half in this repository.

**The fairness line is a rule, not a folder.** What people check about an
open-core product is not the hooks but what goes private over time. So the
rule is written down: private holds only what exists because we charge, or
because we run many accounts. Today that is payment, marketing and an admin
panel that counts registrations. If the admin panel grows into instance
management — a user list, disabling an account, viewing spend — a self-hoster
with `AUTH_SIGNUP=open` would want it, and it belongs public again.

**This ticket adds the seams and moves nothing.** The Stripe code, `admin/` and
`landing/` stay where they are until the private repository builds and runs
against the pinned commit. Deleting them here is the next ticket, one commit,
after that is seen.

## Acceptance

- [ ] `buildServer` accepts `plugins: FastifyPluginAsync[]` and registers each
      one after the auth routes and before the catch-all, so a plugin's routes
      are counted by the session gate and served before `index.html`
- [ ] The billing gate and the billing routes register through that list, not
      by name inside `server.ts`. `server.ts` imports nothing from `billing.ts`
- [ ] `startWorker` and `findDueMonitors` accept an `Entitlement` value —
      the SQL condition for the scheduler and the check for a row already read
      — in place of `BillingMode`. The default entitles everyone
- [ ] `entitlement.test.ts` still drives both halves over the same cases, and a
      case is added for the default
- [ ] Sign-up accepts `onSignup(user)`. `startTrial` is called through it, not
      from `auth.ts`. With no hook, sign-up writes no `subscriptions` row
- [ ] `/api/auth/status` carries what the web app needs to show or hide a
      cloud feature, in a shape a plugin can extend without editing `auth.ts`
- [ ] `apps/web` exports `App` with slots: extra routes, an extra nav item and
      an optional banner. The current `main.tsx` passes none and renders what it
      renders today, asserted by the existing screen tests
- [ ] The Billing screen, its nav item and the trial banner are passed through
      those slots from `main.tsx`, so removing them is deleting lines from one
      file
- [ ] `createStripeBilling`, the billing routes and `Billing.tsx` are the only
      files that import `stripe` or name Stripe. `grep -ril stripe` outside
      them returns docs and tests only
- [ ] `resolveAdminDist` and the admin routes register through the plugin list.
      With no plugin, `/admin` is a 404 and `ADMIN_EMAILS` is not read
- [ ] `pnpm dev`, `pnpm test`, `pnpm build` and `docker compose up` need no
      new variable. Every default is what it is today
- [ ] `docs/billing.md` says what moved, what stayed and why; STACK.md's
      *Hosted version* names the submodule shape and the drift it accepts
- [ ] STACK.md states the rule for what is private: only what exists because
      we charge, or because we run many accounts — payment, marketing,
      operator tooling. Anything one self-hosted person could want stays
      public. The admin panel is named as the case to re-check against it
- [ ] The four seams are documented as an extension API a self-hoster can use
      — a plugin for routes, `onSignup` for a welcome mail, `Entitlement` for
      a cap — so none of them exists only for the cloud
- [ ] A throwaway workspace outside this repository, with this checkout as a
      submodule, builds and starts the API with one plugin registered. Say
      whether this was run or reasoned

## Notes

- `registerBillingGate` must still register before every write route it
  guards. A plugin list runs in order, so the gate is the first cloud plugin,
  and `billing.test.ts` keeps walking every registered route.
- The scheduler's SQL joins `subscriptions` today. Keep the join; the
  `Entitlement` value supplies the condition, not the table.
- Do not publish the packages to npm as part of this. The submodule is the
  chosen link, and a publish step is a decision for later.
- The next ticket, not this one: create `signalscout-cloud`, move `landing/`,
  `admin/`, the Stripe files and the compose files for the cloud stack, then
  delete them here in one commit and remove `admin` from `pnpm-workspace.yaml`
  and the Dockerfile.

## Log

- 2026-09-15T21:58+08:00 — Started on branch `us-136-cloud-plugs-in`. Backend seams first: the plugin list, `Entitlement`, `onSignup`, the admin plugin. The web slots wait until those are reviewed.
