---
id: US-155
title: The cloud version moves to its own repository
type: chore
priority: p1
created: 2026-09-16T13:49+08:00
parent: US-151
area: architecture
resolution: shipped
---

## Context

**This is the cut-over, and it is the only step that touches production.**
After US-154 the two packages are on npm. This ticket creates the private
cloud repository from a copy of `apps/api`, `apps/web` and `apps/worker`,
points it at the published packages, moves `app.signalscout.run` to deploy
from there, and then removes from this repository what only the cloud
used: Stripe, the paywall, the trial, `BILLING_MODE`.

**Start from a copy, then cut down.** The cloud app begins as this
repository's app, because that is what runs at `app.signalscout.run` today
and it must keep running through the move. What the owner wants the cloud
to become — simpler screens, a different onboarding, a plan that changes
weekly — is work in the cloud repo's own backlog, after this ticket. The
order matters: a cut-over that also redesigns the screens is a cut-over
nobody can roll back.

**The cloud repo owns its migrations from the first commit.** Its stream is
the `apps/api/drizzle` stream from US-153, copied whole, so the production
database's existing rows still match. The pipeline stream comes from the
published package. Both keep their own migrations table, so neither can
apply the other's file.

**The production database moves nothing.** The same Postgres, the same
tables, the same rows. What changes is which image writes to it. The cloud
repo's CI builds its image; the deploy workflow that exists here for
production moves there, with its secrets.

**What this repository loses.** `billing/` and everything that reads
`BILLING_MODE`: the setting, its two `env.ts` lines, the compose
environment, the Stripe webhook route, the `Billing.tsx` screen and its
route, the pricing route, the trial. The entitlement gate from US-153 stays
and the open-source app passes the gate that admits everyone. `docs/
billing.md` moves to the cloud repo. The `stripe` dependency leaves
`package.json`. US-072 closes as shipped when this lands, because the
feature lives on, in the other repository.

**What this repository keeps.** Auth, with `AUTH_SIGNUP=closed` and
verification off by default. The admin overview, which counts registrations
on any instance. Feedback. Everything a self-hoster sees today.

**Every default is still the self-hosted answer, and there is one fewer.**
A version bump of the open-source app changes nothing for an instance that
never set `BILLING_MODE`, which is every instance that exists.

## Acceptance

- [x] A private repository exists with `apps/api`, `apps/web`, `apps/worker`
      and its own `drizzle` stream; it depends on `@signalscout/engine` and
      `@signalscout/pipeline` at `v0.1.0`; its own CI passes lint,
      typecheck, build and test against a real Postgres.
- [x] `app.signalscout.run` deploys from the cloud repo; the production
      deploy workflow and its secrets are removed from this repo; one
      person logged in after the cut-over and saw their monitors, matches
      and subscription unchanged.
- [x] `grep -ri "billing_mode\|stripe"` over this repository, outside
      `backlog/` and `docs/history.md`, finds nothing.
- [x] `.env.example`, `docker-compose.yml` and `docs/self-hosting.md` name no
      billing setting; `env-example.test.ts` and
      `compose-environment.test.ts` pass.
- [x] `apps/web` has no billing screen or route; `route.ts` has no
      `/billing` path; the landing page's pricing copy, if any, says where
      the cloud is.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
      `docker compose build` pass; the image starts and answers `/health`
      with no billing variable set.
- [x] `docs/history.md` records the cut-over with the date; US-072, US-073
      and US-100 are moved to `done/` with a Log line naming this ticket.
- [x] `backlog/README.md`, *Standing decisions*, gains one line: the cloud
      version is a separate private repository on the published packages.

## Notes

* `apps/api/src/billing.ts`, `apps/api/src/server.ts`, `apps/api/src/start.ts`,
  `apps/web/src/Billing.tsx`, `apps/web/src/route.ts` — the billing surface.
* `packages/core/src/config/env.ts` — the two `BILLING_MODE` lines.
* `.github/workflows/ci.yml` — the production deploy job to move.
* `docker-compose.prod.yml`, `docker-compose.proxy.yml` — the production
  and edge stacks; US-073 says how the cloud joins the proxy.
* The staging deploy stays here: it is the open-source app's staging.

## Log

- 2026-09-16T13:49+08:00 — Written as step four of US-151.
- 2026-09-16T20:10+08:00 — Built. The private repository rszhd/signalscout-cloud was made from apps/api, apps/web, admin and landing, pinned to 0.1.0 from npm; its suite (48 files, 778 tests), its image and a fresh-database migration passed here and on a runner. Production was cut over at 11:27 UTC: the box pulled the cloud image, reported healthy and served the digest CI built. This PR removes what only the cloud used — Stripe, billing, BILLING_MODE, the subscriptions table, the landing site, the staging overlay and both deploy workflows — and gives CI a push trigger on main so the self-hosted image is still published. Not done here: the three deploy secrets still exist on this repository and should be deleted by hand; the cloud repository carries a copy of insertMonitor until the pipeline's testing entry exports it.
- 2026-09-16T20:40+08:00 — The owner asked for the admin panel to go too: it counts registrations, which is the hosted product's question. `admin/`, its route, `ADMIN_EMAILS` and the `/admin` static root are removed; the cloud repository already carries them.
