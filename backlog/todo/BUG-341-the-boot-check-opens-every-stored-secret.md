---
id: BUG-341
title: The boot check opens every stored secret
type: bug
priority: p2
created: 2026-09-23T10:05+08:00
parent:
area: secrets
resolution:
---

## Context

`assertStoredCredentialsAreReadable` decrypts `source_credentials` and nothing
else. Model keys (`ai_keys`, since US-068) and webhook signing secrets
(`webhook_secrets`, since US-096) are sealed with the same `ENCRYPTION_KEY`,
and neither is read at boot. A wrong or rotated-away key therefore starts a
process that looks healthy, and the error arrives at the first model call or
the first signed delivery — the failure the boot check exists to move to
boot.

It is worse on the hosted application, which reads no provider key from the
database since US-164 there: its only stored secrets are webhook secrets, so
its boot check proves nothing about them. And an instance with no provider
key row returns early before checking whether a key is needed at all.

BUG-339 made the documents say this. This ticket makes the check true.

## Acceptance

- [ ] The boot check decrypts every row of `source_credentials`, `ai_keys`
      and `webhook_secrets`, and refuses to start naming the row it cannot
      open.
- [ ] An instance with rows in any of the three and no `ENCRYPTION_KEY`
      refuses to start with the sentence that says how to make one.
- [ ] Each table has its own case, written before the change, and each was
      seen to fail.
- [ ] `docs/secrets.md` drops the "not in that check yet" sentence and step
      6 of *Rotating the key* says the boot check is the verification again.
- [ ] The hosted repository is told, because its `docs/secrets.md` carries
      the same caveat.

## Notes

`packages/pipeline/src/secrets/store.ts`, `assertStoredCredentialsAreReadable`.
Credential encryption is a correctness-critical surface: test-first.

A webhook secret's record is derived from the account on each read, not read
from the row (`notifications/secret.ts`), so the check must derive it the same
way or it will accept a row copied between accounts.

## Log

- 2026-09-23T10:05+08:00 — Found while checking docs/secrets.md against the
  code for BUG-339.
