---
id: US-004
title: A stored key is encrypted at rest
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

For the first release, credentials live in `.env` and the whole instance uses
one set. That is what PLAN.md describes and it needs no encryption, because
the file is already outside the database and outside git.

This ticket is for the moment that stops being true: more than one monitor
with different credentials, or the hosted version, where keys reach a database
we run. On that day a plaintext key column is a breach waiting for a backup to
leak.

It is written now, and left in `todo/`, so the decision is not made in a hurry
by whichever ticket first needs a second key.

The shape: AES-256-GCM using Node's `crypto`, with the key from
`ENCRYPTION_KEY`. No external key service, because a self-hoster must not need
one. GCM rather than CBC because it authenticates, so a tampered ciphertext
fails loudly instead of decrypting to noise.

The part that is easy to get wrong is not the cipher. It is everything around
it: a key that is missing at boot, a key that changed, and a decrypted value
that reaches a log line.

## Acceptance

- [x] Credentials are stored encrypted with AES-256-GCM, key from
      `ENCRYPTION_KEY`
- [x] Each value has its own nonce, and the nonce is stored with the ciphertext
- [x] A missing or wrong-length `ENCRYPTION_KEY` fails at boot with a message
      that says how to generate one, not at first decrypt
- [x] A value that cannot be decrypted fails loudly and names the record; it is
      never treated as empty
- [x] A decrypted credential never reaches a log line, an error message or an
      API response — asserted by a test, not by review
- [x] The API returns a masked form only, and there is no endpoint that returns
      a stored key
- [x] Rotating `ENCRYPTION_KEY` has a documented procedure, even if it is
      manual

## Notes

- Depends on [US-002](../done/2026-09/US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- Not on the path to the first match. It becomes p1 the day a key moves out of
  `.env` and into the database, and it must land before that, not after.
- STACK.md, *The stack*, `Secrets at rest`. The procedure and the reasoning
  are in [docs/secrets.md](../../docs/secrets.md).
- **A missing key fails at boot only on an instance that stores one.** The
  third box is met under that condition and not without it. An instance with
  no `source_credentials` row needs no key, and demanding one would make
  `pnpm dev` fail on a clean checkout for a feature that is switched off. The
  failure the box exists to prevent — a key discovered lazily, at the first
  decrypt, during a poll — cannot happen either way: the check decrypts every
  stored row at startup. A wrong-length key is refused at boot unconditionally.
- **Nothing writes a credential yet.** The store, the guards and the reading
  path are here; the screen that would put a key in them is the
  connection-testing screen [US-010](../doing/US-010-a-monitor-is-created-from-four-answers.md)
  defers. `worker/credentials.ts` reads the store first and falls back to the
  environment, so an empty table is exactly today's behaviour.
- **The rotation command has never been run.** `rotateEncryptionKey` is
  asserted against real Postgres, including the case where one row cannot be
  read and the transaction changes nothing. `rotate-cli.ts` around it is not.
  Say the procedure is written and unexercised until somebody rotates a key.

## Log

- 2026-09-04T22:49+08:00 — Written from STACK.md. Deliberately kept out of the first
  release: env vars need no encryption, and pretending otherwise adds a key to
  manage for no gain.
- 2026-09-05T13:13+08:00 — Built the cipher, the store, the boot check, the
  redaction and the rotation. Test-first, as the surface requires: the
  assertions in `secrets/cipher.test.ts`, `secrets/store.test.ts`,
  `secrets/leak.test.ts` and `apps/api/src/credentials.test.ts` were written
  before the code under them.

  Four decisions worth keeping. The record's name is authenticated with the
  value, so a row copied from one source's credential into another's does not
  decrypt — without it a swap inside the database is invisible. A failed
  decrypt throws and never returns an empty string, because an empty
  credential is four failed provider calls about a problem nobody can see. The
  ciphertext column carries a check constraint, so a plaintext key pasted in
  by hand is refused by Postgres rather than handed to a connector. And the
  masked form is its own column, so showing which key is set decrypts nothing.

  The boot check has two callers, the API and the worker, and each has its own
  case: docs/testing.md, *a rule is only as tested as its least-tested
  caller*. Writing the worker's found a real leak — a refusal left the pool
  open, so the process would not have exited.

  Eight deliberate mutations were confirmed to turn the suite red: dropping
  the authenticated record name, fixing the nonce, returning an empty string
  from a failed decrypt, emptying the redaction list, deleting the boot check
  from each caller in turn, ignoring a stored credential in the monitor rules,
  and widening the mask. The whole suite passes, 573 tests. Lint, typecheck
  and the production build pass.
