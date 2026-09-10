---
id: US-102
title: A self-hosted install starts from the commands we print
type: bug
priority: p1
created: 2026-09-10T09:50+08:00
resolution: shipped
---

## Context

The README tells a self-hoster to copy `.env.example` and run compose. Follow
those commands exactly and the app never comes up.

`.env.example` carries `AUTH_SECRET=` empty, because a secret in git is a
secret every reader of this repository holds. `apps/api/src/start.ts` refuses
to boot without it, and `docker-compose.yml` restarts the container, so the
first run is a restart loop. `scripts/dev.mjs` generates one — but only for
`pnpm dev`, so the Docker path, which is the one a self-hoster takes, is the
one without the convenience.

**The second wall is one step further in and it is worse.** `ENCRYPTION_KEY` is
also empty. The app boots, the person makes their account, and US-088's
onboarding gate then asks for a provider key and a model key before it gives up
the product. Neither can be stored: `connections.ts` and `models.ts` both
refuse with *"This instance cannot store a key yet"*, and the gate has no route
past it. The instance is unusable until somebody stops, reads, edits `.env` and
restarts.

Both refusals name the variable and the fix, which is the good half. Neither is
silent. But a person meets them after the failure, in a log or on a dead-ended
screen, and the `openssl` line they need is in `docs/accounts.md` rather than
where they are standing.

A person who puts provider keys in `.env` instead never sees the gate, so
whether the install works depends on which of the two documented paths is
taken — and the README's own onboarding paragraph points at the one that
breaks.

## Acceptance

- [x] One command writes a `.env` that boots: it copies `.env.example` when
      there is none, and generates `AUTH_SECRET` and `ENCRYPTION_KEY` when
      they are missing
- [x] It never overwrites a value that is already set, so it is safe to re-run
      on an instance that already holds encrypted credentials
- [x] `pnpm dev` calls the same code, so the Docker path and the development
      path cannot drift
- [x] It says when `POSTGRES_PASSWORD` is still the shipped default
- [x] The README's install block runs start to finish on a clean checkout
- [x] The script has tests, and they run in `pnpm test`

## Notes

- `scripts/dev.mjs` already holds the `.env` bootstrap. Extract rather than
  copy: two generators for one secret is how one of them ends up weaker.
- `POSTGRES_PASSWORD` is generated for nobody. Replacing it on an instance
  whose volume already exists locks the app out of its own database, so this
  says it rather than doing it.
- `vitest.config.ts` includes only `{apps,packages}/*/src/**`, so `scripts/`
  is not covered today.
- The script needs Node, and the Docker path exists so a server never installs
  one. So the README carries the `openssl` two-liner beside it. That is a
  second way to produce the same value rather than a second generator: the
  format is `openssl rand -base64 32` in both, and `config/env.ts` is what
  enforces it.

## Log

- 2026-09-10T09:50+08:00 — Added the ticket, after walking the README's own
  install path through the code.
- 2026-09-10T09:55+08:00 — Shipped. `scripts/init-env.mjs` is the one
  generator and `pnpm dev` imports it, so the path that needed the convenience
  least no longer has it alone.

  **The first version of the fix was wrong in the same way the bug was.**
  `pnpm setup` needs Node, and a server never installing Node is the reason the
  Docker path exists — so the README carries the `openssl` two-liner beside it,
  and both were run start to finish before this closed. `docker compose config`
  confirms the appended value is what reaches the container, which matters
  because `.env.example` already carries an empty `AUTH_SECRET=` line above it.

  **The test asserts the key against the application's own check.**
  `encryptionKeyIsWellFormed` is imported from core rather than the length
  being counted here: a generator that agrees only with its own test is a
  generator that writes a value the app refuses at boot. Two deliberate
  mutations were confirmed to turn it red — dropping the do-not-overwrite guard
  fails three cases, and halving the byte count fails one.

  `vitest.config.ts` gained `scripts/**/*.test.mjs`, so `scripts/` is visible
  to the suite for the first time. 1,798 tests pass, 13 of them new.
