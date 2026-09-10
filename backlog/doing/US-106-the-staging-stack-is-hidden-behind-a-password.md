---
id: US-106
title: The staging stack is hidden behind a password
type: feature
priority: p1
created: 2026-09-10T11:58+08:00
parent: US-073
area: deployment
resolution:
---

## Context

**Staging takes registrations, and the public can reach it.**
app.signalscout-dev.space runs `AUTH_SIGNUP=open` with
`AUTH_EMAIL_VERIFICATION=required` (US-100, Notes). Anybody who can read mail
may make an account. US-081 keeps them off the machine's provider and model
keys, so the harm is not a bill. The harm is an account on a half-built
product, and a registration flow that faces the whole internet.

**The lock belongs on the edge, not in the app.** Staging exists to rehearse
production's shape, and production must keep taking registrations. The app
already holds the right gate for the cloud. What staging needs is a door in
front of the whole site, so that no request reaches the app without a password.

**Traefik already fronts the stack, and a middleware is a proven shape.**
`docker-compose.prod.yml:54` already attaches the `robots` middleware to the
router. A second middleware of type `basicauth` is the same mechanism:
Traefik answers `401`, the browser prompts, and only then does the request
reach the app. The app's own login and session sit behind it and are untouched.

**The shared compose file is the difficulty.**
`docker-compose.prod.yml` serves both staging and production. A middleware
attached to the router unconditionally puts a prompt on production, and with no
users configured it refuses every request there. So the middleware must reach
the staging router alone. A staging overlay, layered only by
`deploy-staging.yml`, is that. It keeps the two thin workflows (US-075) each
knowing one answer, and it adds no branch to the shared file.

**The password hash needs one trick.** `htpasswd -nbB` makes a bcrypt hash, and
a bcrypt hash starts with `$2y$`. Docker Compose reads `$` as a variable, so a
hash written into the compose file must double every `$` to `$$`. The hash goes
in the box's `.env` instead, and the label reads the variable. The hash then
never enters the repository, which is where it must never be.

## Acceptance

- [x] `docker-compose.staging.yml` defines a `basicauth` middleware named for
      the stack and adds it to the staging router's middleware list, and
      `docker compose config` for the production pair shows no `basicauth`
      middleware and no change to the production router
- [x] The user list comes from the box's `.env`; no password and no hash is
      committed to the repository
- [x] `deploy-staging.yml` and `scripts/deploy-remote.sh` layer the overlay on
      staging only, and `deploy-production.yml` does not
- [ ] `https://app.signalscout-dev.space` answers `401` without credentials and
      serves the app after them — **live, in a browser**
- [ ] The app's own login and session still work behind the prompt. The
      session is a cookie and no route here reads `Authorization`, so it does
      not matter whether Traefik forwards the header
- [x] The container healthcheck and the deploy digest assertion are unaffected,
      because both bypass the proxy
- [x] `docs/accounts.md` says how to set the password and how to rotate it
- [x] A test fails when the overlay stops attaching the middleware to the
      staging router, and passes with production unaffected — the shape
      `compose-environment.test.ts` already uses

## Notes

- **Why not `AUTH_SIGNUP=closed`.** That is config-only and instant, but it
  refuses every account after the first, so staging cannot add a tester, and
  staging stops rehearsing the registration and verification path that
  production runs. The edge lock keeps the app's flow testable.
- **Why not a value on the shared router label.** A router that names a
  middleware which does not exist answers `503`. An empty middleware name is
  the same failure. The overlay is a file rather than an expression, which is
  the rule the two deploy workflows already follow.
- **Traefik does not strip the header, and it does not need to.** Traefik v3
  `basicauth` has `removeHeader` and it defaults to **false**, so the browser's
  `Authorization: Basic …` reaches the app on every request. That is harmless
  here: the session is a cookie, and no route in this repository reads the
  `Authorization` header. Do not add one without setting `removeHeader=true`
  first.
- Generate the value on the box: `htpasswd -nbB staging 'the-password'`. Put
  the whole `user:hash` line in `TRAEFIK_BASIC_AUTH_USERS` in the staging
  `.env`. Several users are comma-separated.
- The script hardcodes its compose files at `scripts/deploy-remote.sh:38` and
  copies three files at lines 52-54. The overlay must travel with the image the
  same way, or a deploy boots a new build against a compose set that has
  forgotten the lock.
- **The `$` is the trap.** If the hash is ever written into a compose file
  directly, every `$` needs `$$`. Prefer the `.env` variable so the value is
  inserted literally and never re-read.
- Rollback is removing the overlay from the staging command. No row changes and
  no migration is involved.
- This is a second lock, not a replacement. The app's session gate stays.

## Log

- 2026-09-10T11:58+08:00 — Written on the owner's decision. Staging runs open
  registration, and the wanted lock is a password at the edge rather than
  `AUTH_SIGNUP=closed`, so that the app's registration and verification path
  stays testable and production is untouched.
- 2026-09-10T12:10+08:00 — Built. `docker-compose.staging.yml` defines
  `${TRAEFIK_NAME}-basic` and replaces the router's `middlewares` label with the
  robots list plus its own. `deploy-remote.sh` takes an optional fifth argument
  and appends it to both the compose command and the copied files; only
  `deploy-staging.yml` passes `docker-compose.staging.yml`. `TRAEFIK_BASIC_AUTH_USERS`
  is documented in `.env.example` and `docs/accounts.md`.

  **The merge is the thing worth checking, so the test renders it.** Two
  `docker compose config` runs, one per stack, assert the staging router carries
  the basic-auth middleware and the production router does not. A text test
  cannot see a label merge. Removing the overlay's router line was confirmed to
  turn it red.

  **The `$` behaves as the ticket predicted.** The hash is interpolated from
  `.env`; Compose's config output shows it escaped as `$$2y$$05$$…`, which is
  the canonical form of a literal `$`, so the value Traefik receives is correct.

  `pnpm lint` and `pnpm typecheck` pass. The suite is 1,824 passed and one
  failed, and the failure is not this ticket: `collect.test.ts` carries an
  uncommitted BUG-015 test, added before this work began, that stays red until
  `collect.ts` deduplicates a batch.

  Both live boxes stay open. Nothing has deployed, so no browser has met the
  prompt and the header-stripping claim is unproven.
- 2026-09-10T13:20+08:00 — Renumbered from US-105 to US-106 on review. Two
  tickets were written the same hour in the same working tree and both took
  105; US-105 is the onboarding marker, which shipped first and carries its
  number in a migration comment. The number moved here because three code
  comments named it and nothing else did.

  Two corrections came with the review. **Traefik does not strip the
  `Authorization` header**: `removeHeader` defaults to false, not true, so the
  browser's credentials reach the app on every request behind the prompt. The
  app's login is unharmed because the session is a cookie and no route in this
  repository reads that header, which is the reason the acceptance box now
  gives. And `.env.example` said an empty value runs the stack without the
  prompt; it does not. `${TRAEFIK_BASIC_AUTH_USERS:?}` refuses an empty value
  as well as a missing one — measured, `docker compose config` stops with the
  overlay's own sentence — so an empty value stops the deploy rather than
  unlocking the site.
