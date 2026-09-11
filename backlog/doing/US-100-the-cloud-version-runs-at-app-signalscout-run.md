---
id: US-100
title: The cloud version runs at app.signalscout.run
type: feature
priority: p1
created: 2026-09-10T03:05+08:00
parent: US-073
area: deployment
resolution:
---

## Context

There is a staging stack and no production one. US-073 put SignalScout behind
the box's shared Traefik at `app.signalscout-dev.space`, US-075 made a push to
`staging` deploy itself, and US-077 recorded that `main` gets the same treatment
"when there is a production stack". There is none, `main` is 218 commits behind
`dev`, and `ghcr.io/rszhd/signalscout:latest` has never existed — so the
`docker compose up` README.md tells a self-hoster to run cannot work.

**This stack is the cloud version, and that is what makes it different from
staging.** It takes registrations, so three rules that have never mattered on a
single-account box all matter at once: US-081 empties the machine's keys out of
an open instance, so every account brings its own provider and model keys;
US-092's verification is required, because an address nobody proved is an
account nobody can be billed for; and US-072's paywall is on with a real Stripe
key, a real product and a real price.

**BUG-010 was the blocker and it is fixed.** `source_providers` was keyed by
the platform alone, so on an open instance one account's provider choice
decided what every other account polled through — and could refuse their polls
outright. Opening registration before that was fixed would have shipped the
fault to the people it was written about.

**Both stacks live on one box and share only the edge.** The proxy is
`qassist-proxy`, already running, already holding the ACME volume for every
hostname on the machine. SignalScout production is a third compose project
beside `signalscout-staging`, with its own Postgres, its own volume and its own
`.env`. `TRAEFIK_NAME` is what keeps the two routers apart, and it is a value
rather than a literal for exactly this reason.

**The deploy workflow is a twin rather than a parameter.** US-075 said the
workflow must not learn which environment it is serving. One file branching on
the ref would put the directory, the project name and the box behind an
expression, and an expression that evaluates wrong deploys one environment over
the other. Two thin files each know one answer.

## Acceptance

- [x] A live Stripe product, a $20 monthly price and a webhook endpoint exist
      on the production account, subscribed to the five events `stripe.ts` acts
      on and no others
- [x] `deploy-production.yml` deploys a push to `main`, calling `ci.yml` rather
      than copying it, into its own directory and compose project
- [x] `ci.yml` no longer runs on a push to `main`, so a release is checked once
      rather than twice
- [ ] The box holds a production `.env` with its own generated `AUTH_SECRET`,
      `ENCRYPTION_KEY` and Postgres password, and no provider or model key
- [x] A push to `main` publishes `:latest` and puts that digest on the box,
      asserted by the run rather than assumed — which closes US-077's last box
- [x] `https://app.signalscout.run` answers over TLS with a Let's Encrypt
      certificate for that hostname, and HTTP redirects to it
- [ ] An account registers, receives the verification link, opens it, and lands
      on the onboarding gate — the first registration on the cloud version
- [ ] A login over the proxy sets a `Secure` session cookie, proven in a
      browser — which closes US-073's last box
- [ ] Stripe delivers a live event to the endpoint and the signature verifies

## Notes

- The staging `.env` is the template for the production one, with four values
  changed and three generated. Never copy the file: its Postgres password
  belongs to a different database.
- `AUTH_SIGNUP=open` and `AUTH_EMAIL_VERIFICATION=required` go together here.
  Verification needs SMTP, and `emailVerificationRequired` throws at boot when
  the mode asks for what the settings cannot deliver.
- `ROBOTS_TAG` is `all` on production and `noindex, nofollow` on staging. That
  is the only difference between the two that a crawler can see.
- Nothing about a live payment is proven by this ticket. The product and price
  exist; no card has been entered, and the entitlement path past the trial has
  never run against a real subscription.

## Log

- 2026-09-10T03:05+08:00 — Written after BUG-010 closed, which was the blocker
  the owner named. The live Stripe objects were created first, because the
  webhook secret is one of the values the box's `.env` needs and the endpoint
  cannot be made before the hostname it points at is decided.

- 2026-09-11T13:12+08:00 — Two boxes closed by reading what has already run,
  and one that cannot be closed from here.

  The stack is up. `https://app.signalscout.run` answers 200 with a Let's
  Encrypt certificate whose subject is that hostname, valid 2026-09-09 to
  2026-12-08, and `http://` returns 301 to it. `x-robots-tag: all`, which is
  the one crawler-visible difference from staging the Notes ask for.

  The release path is proven end to end. The production deploy of
  2026-09-10T17:34Z published `sha256:78b6fe5f48ed`, pulled that digest on the
  box, and its own last step says `signalscout is serving the build this run
  produced`. The same digest is what `ghcr.io/rszhd/signalscout:latest` now
  answers with, so US-077's last box closed with it.

  The `.env` box stays open. The app boots, so the file exists and holds
  `AUTH_SECRET`; the other half of that box — that it carries no provider or
  model key — is a statement about a file on the box, and reading it needs SSH,
  which this session was refused. It is the owner's to confirm.

  The last three boxes are unchanged and all need a person. Registering an
  account is an account creation and a password entry, which this agent may not
  do whoever asks; the browser extension is also not connected here, so the
  `Secure` cookie cannot be read either. Both wait on the owner.

