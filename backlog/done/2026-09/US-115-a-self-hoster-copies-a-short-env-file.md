---
id: US-115
title: A self-hoster copies a short env file
type: chore
priority: p2
created: 2026-09-11T01:51+08:00
area: install
resolution: shipped
---

## Context

`.env.example` is 430 lines and 66 variables. It is the human-readable copy of
`config/env.ts` and it has to stay that, because a variable the schema declares
and the file omits is a setting nobody knows exists — the same shape
`compose-environment.test.ts` guards on the container side.

But it is also the file `pnpm setup` copies, so it is the first thing a
self-hoster reads. Most of what it holds is not theirs. Stripe, `APP_URL`,
`ADMIN_EMAILS`, `AUTH_TRUSTED_ORIGINS`, the Traefik router names and the
staging basic-auth hash are the cloud shape; the model price overrides, the
draft block and the triage block are dials nobody turns on a first install.
Against that, the whole self-hosted install is about a dozen values: two
generated secrets, a Postgres password, one provider key, one model key.

A reference and a starting point are two documents. One file has been both,
and the cost lands on the person with the least context.

Every variable in `docker-compose.yml` carries a `:-default`, and every
optional field in the schema reads blank as unset. So a short `.env` boots —
the long file is not load-bearing, it is only what we hand people.

## Acceptance

- [x] `.env.example.self-hosted` holds only what a self-hosted instance sets,
      and says in one line where the rest is
- [x] `pnpm setup` copies it, so the file a self-hoster starts from is the
      short one
- [x] It carries `POSTGRES_PASSWORD=intentwatch`, so `init-env.mjs` still says
      the password is the shipped default
- [x] It carries `DATABASE_URL`, so `pnpm dev` and `pnpm test` still reach
      Postgres from the host
- [x] A test fails when a name in it is not a variable the application reads
- [x] A test fails when a cloud-only setting appears in it
- [x] A test fails when `.env.example` stops naming every variable the schema
      declares — the claim US-001 makes and nothing checked
- [x] A test fails when git would not commit either example file
- [x] `docs/self-hosting.md` and `README.md` name the file a person copies

## Notes

- The reference file does not shrink. It is what `config/env.ts` is mirrored
  against, and shortening it would make the mirror partial.
- The provider variables are not in the schema: they are derived per connector
  by `environmentVariableFor`, which is why the test builds that set from
  `builtInSources` the way `compose-environment.test.ts` does.
- Compose-only names — `POSTGRES_*`, `COMPOSE_PROFILES`, `SIGNALSCOUT_IMAGE`,
  `APP_HOST`, `ACME_EMAIL` — are read by the compose files rather than by the
  app, so the test allows them from a written list rather than from the schema.

## Log

- 2026-09-11T01:51+08:00 — Added the ticket.
- 2026-09-11T02:00+08:00 — Shipped. `.env.example.self-hosted` is twenty-nine
  names against the reference's sixty-six, and `scripts/init-env.mjs` copies it.

  **The file is committed, so its own parsing is part of the work.** The first
  draft put the provider comments after the values — `BRIGHTDATA_API_KEY=  #
  Reddit` — which reads well and is a different thing in every parser that
  touches it: Compose, Node's `--env-file`, and `readEnvFile` in the setup
  script all treat a trailing `#` differently. Comments went onto their own
  lines. A reference nobody copies can be written for the eye; a file that
  boots cannot.

  Proven rather than argued: `ensureEnvFile` was run against a scratch root,
  and `docker compose --env-file` on what it produced shows `AUTH_SIGNUP:
  closed`, `BILLING_MODE: off` and a built `DATABASE_URL` — three settings the
  short file never names. `loadEnv` parses the same file with no error.

  **`.gitignore` had `.env.*` and one exception by name, so git could never
  have committed the new file.** The suite passed, the install worked here, and
  a clone would have had `pnpm setup` copy a file it did not have. Found by
  reading `git status` rather than by any check — so the check exists now, and
  it asks git rather than reading the patterns, because the matching is the
  part that goes wrong. The exception is named rather than globbed:
  `!.env.example*` would also un-ignore a `.env.example.local` somebody made by
  filling one in.

  Five deliberate mutations turn `env-example.test.ts` red: a hosted setting
  added to the short file, a variable renamed in it, a schema variable dropped
  from the reference, the gitignore exception removed, and that exception
  widened to a glob. 1,922 tests pass, 10 of them new.
