---
id: US-074
title: The container carries every setting the app declares
type: bug
priority: p0
created: 2026-09-08T18:31+08:00
parent: US-073
area: deployment
resolution: shipped
---

## Context

`docker-compose.yml` passes **17** environment variables into the container.
`packages/core/src/config/env.ts` declares **48**. The other 31 cannot reach a
deployment started with `docker compose up`, whatever anybody writes in `.env`
— Compose reads that file for interpolation, finds no line to interpolate the
value into, and starts a container that never sees it.

**Five of the missing ones are the paywall**: `BILLING_MODE`, the three
`STRIPE_*` values, and `APP_URL`, which `billing/config.ts` needs because it is
where Checkout sends a person back. So `BILLING_MODE=stripe` in a `.env` is
read by nothing. The instance boots in `off` mode, every screen works, every
trial runs out, and nobody is asked for money.

That is US-072's own failure shape, one level further out. `start.ts` refuses to
boot on `BILLING_MODE=stripe` with a missing price or webhook secret, precisely
because the quiet state is the dangerous one. **The boot check cannot fire when
the variable never arrives.**

**Twenty-four more are the model settings** — provider, model, key, timeout,
the four price fields, and the triage, embedding and draft groups. A
self-hosted instance run from the published image therefore has no
instance-level model configuration at all. Nobody has noticed because US-068
lets an account paste its own key on a screen, which quietly covers for it.

The list is maintained by hand and has drifted silently since the first
variable was added to one file and not the other. A test is the only thing that
stops it drifting again, and it must **enumerate rather than sample** — the
variable added next month is the one nobody checks — the same rule
`auth.test.ts` uses to walk every registered route.

## Acceptance

- [x] Every variable `config/env.ts` declares is passed to the app, the worker
      and the migrations, or is on a written list of deliberate exclusions
- [x] A test reads the declared set and the compose file and fails when one is
      declared and not carried, naming it
- [x] The exclusion list is in the test, with a reason per entry, so an omission
      is a decision somebody wrote down rather than an oversight
- [x] `BILLING_MODE=stripe` with the three Stripe values and `APP_URL` set in
      `.env` reaches the container, and the boot check refuses when one is
      missing — proven by starting a container, not by reading the file
- [x] `.env.example` names every variable the compose file now carries

## Notes

- `WORKER_IN_PROCESS` is already correct: it is set per service rather than in
  the shared block, because the app and the worker need different values.
- `WEB_DIST_PATH` is a candidate for the exclusion list — it addresses a path
  inside the image, and a deployment has no business moving it.
- The three services share `x-app-environment`, so one addition covers all
  three. The migrations need the database settings only, but carrying the rest
  costs nothing and keeps one list rather than three.
- Read docs/billing.md before changing what billing reads. A key that is live
  rather than test charges a real card from a staging box.

## Log

- 2026-09-08T18:31+08:00 — Found while asking why staging had no billing. The
  answer had two halves: the setting was left at its default, and it could not
  have been set anyway.
- 2026-09-08T18:40+08:00 — The block now carries 53 settings against 17. The
  five billing ones, the twenty-four model ones, and — found while writing the
  test rather than the ticket — **the five provider keys**, which were missing
  too. A self-hosted instance run from the published image could not set
  BRIGHTDATA_API_KEY or any of its siblings, so it had no way to poll anything
  except through a key pasted on a screen.

  Proven against a real container rather than the file: `docker run` with
  `BILLING_MODE=stripe` and one Stripe value refused to boot, naming
  `STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET, APP_URL`. Before this change the
  same container started happily and charged nobody.

  The test enumerates three ways: the schema's own keys, the registry's
  provider variables, and the exclusion list checked back against the schema so
  a stale exclusion cannot hide a live setting. Deleting one line from the
  compose file turns it red and names it. Five exclusions are deliberate and
  carry a reason each; four are set by the compose file itself and
  `WEB_DIST_PATH` addresses a path inside the image.
