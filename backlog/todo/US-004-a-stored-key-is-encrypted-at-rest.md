---
id: US-004
title: A stored key is encrypted at rest
type: feature
priority: p2
created: 2026-09-04
parent:
area:
resolution:
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

- [ ] Credentials are stored encrypted with AES-256-GCM, key from
      `ENCRYPTION_KEY`
- [ ] Each value has its own nonce, and the nonce is stored with the ciphertext
- [ ] A missing or wrong-length `ENCRYPTION_KEY` fails at boot with a message
      that says how to generate one, not at first decrypt
- [ ] A value that cannot be decrypted fails loudly and names the record; it is
      never treated as empty
- [ ] A decrypted credential never reaches a log line, an error message or an
      API response — asserted by a test, not by review
- [ ] The API returns a masked form only, and there is no endpoint that returns
      a stored key
- [ ] Rotating `ENCRYPTION_KEY` has a documented procedure, even if it is
      manual

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md).
- Not on the path to the first match. It becomes p1 the day a key moves out of
  `.env` and into the database, and it must land before that, not after.
- STACK.md, *The stack*, `Secrets at rest`.

## Log

- 2026-09-04 — Written from STACK.md. Deliberately kept out of the first
  release: env vars need no encryption, and pretending otherwise adds a key to
  manage for no gain.
