---
id: US-067
title: A provider key belongs to an account
type: feature
priority: p1
created: 2026-09-08T03:45+08:00
parent: US-017
area:
resolution: done
---

## Context

US-017 scoped monitors, projects, matches, verdicts and reply voices to an
account and deliberately left provider keys on the instance. The reasoning is in
that ticket's Log: `source_credentials` is keyed by `(provider, field)`, and the
same lookup falls back to the process environment, which cannot belong to a
person.

US-066 made that reasoning obsolete. With `AUTH_SIGNUP=open` a stranger can
register, and today they would share one row per provider with everybody else.
Three things follow, and each is worse than the last: they poll on the owner's
key and against the owner's bill; the second person to paste a key **silently
overwrites** the first; and anybody signed in can delete a key and stop every
monitor on the instance.

**The environment stays instance-wide, and that is the self-hosted path.** A
self-hoster puts `BRIGHTDATA_API_KEY` in `.env` and never opens the connections
screen. What changes is the database half: a stored row gains an owner, and a
poll reads the row belonging to the monitor's owner. An account with no row of
its own on an instance with no environment key **cannot poll** — and that
refusal is the point, because the alternative is spending somebody else's money.

The cipher makes this cheap, and US-024 already proved the path.
`source_credentials.record` is stored per row and is what the ciphertext is
authenticated with, so changing the naming rule re-encrypts nothing: an old row
opens under the name it was sealed with, and normalises the first time it is
rewritten.

## Acceptance

- [x] `source_credentials` carries `user_id`, in its primary key, and a
      migration backfills existing rows to the first account or to the
      pre-account id
- [x] The connections screen reads and writes only the signed-in person's keys,
      including the hints and the delete
- [x] A poll uses the key belonging to the monitor's owner, and falls back to
      the environment
- [x] An account with no key of its own on an instance with no environment key
      cannot start a monitor, and is told which key is missing
- [x] One account's key is never readable, overwritable or deletable by another,
      asserted against real Postgres
- [x] Key rotation and the boot check still cover every row, whoever owns it
- [x] Nothing in a log line or an API response carries a key, still

## Notes

- Correctness-critical: credential encryption. Written test-first.
- `credentialRecordName` gains the owner. Old rows keep their stored `record`
  and still decrypt — that is the whole reason this is a migration and not a
  re-encryption.
- The LLM half is [US-068](US-068-a-model-key-belongs-to-an-account.md). It is a
  different mechanism: the worker builds one classifier at boot from `.env`,
  not one per monitor.

## Log

- 2026-09-08T03:45+08:00 — Written after the owner asked for per-account keys:
  "every user need to enter their own API keys for providers & LLM usage".
  Split from the model half, which changes the worker's shape rather than a
  table's key.
- 2026-09-08T10:40+08:00 — **Two names, not one.** `credentialRecordName` gains
  the owner because it is what the ciphertext is authenticated with: without it
  a row moved between two accounts' slots by anybody with `psql` decrypts
  happily, and the primary key alone does not stop that. `credentialSlotName`
  is new and deliberately does *not* carry the owner — it keys the readiness
  set, which is already one person's, and an account id in a "this key is
  missing" sentence would name somebody nobody asked about. The first version
  used one function for both and the tests were written against two.
- 2026-09-08T10:45+08:00 — `CredentialLookup` takes the owner as an argument
  rather than being built per account. One worker process serves every account,
  so a lookup per account would be a cache keyed by something, and the
  something is the owner. Five call sites, each with a monitor already in
  scope — except the cost test, which usually has no monitor at all, so
  `query_estimates` gained its own `user_id`. A sample is real money at a real
  provider and the row has to say whose account paid.
- 2026-09-08T10:50+08:00 — **The environment lookup ignores the owner, and that
  is the self-hosted path.** `BRIGHTDATA_API_KEY` belongs to the machine, so an
  instance configured that way behaves exactly as before. The consequence is
  written into `.env.example` and docs/accounts.md rather than left implicit:
  an instance with **both** a `.env` key and `AUTH_SIGNUP=open` lets a stranger
  poll on the machine's key. Empty the environment before opening signup.
- 2026-09-08T11:05+08:00 — Boot check and rotation stay instance-wide, and each
  has a case. A key that opens one account's rows and not another's must stop
  the process; a rotation covering one account would leave the rest sealed
  under a key nobody has. `allStoredCredentialNames` is a separate function
  rather than an optional argument, because an optional owner is how a route
  ends up reading everybody's keys by forgetting one.
- 2026-09-08T11:20+08:00 — **Proven live, two accounts, against the built app.**
  Both registered under `AUTH_SIGNUP=open`; two rows in `source_credentials`
  with records `<a>:brightdata:apiKey` and `<b>:brightdata:apiKey`. A's screen
  showed `••••AAAA` and B's `••••BBBB` — same provider, same instance, neither
  seeing the other. B deleted its own key: 200, and **A's row survived**;
  B tried again owning nothing: 404. B's monitor form then said Reddit was not
  ready and named `BRIGHTDATA_API_KEY`, while A's said ready. That is the whole
  ticket, seen from the screen.
- 2026-09-08T11:25+08:00 — Closed. 1,407 tests pass. Migration 0044 applied to
  a database with existing rows before any of the above.

  Unproven: no live poll has run on a per-account key — the connectors were
  never called, because a real provider probe needs a real key. The path from
  the row to the connector is covered by the worker's tests and by the
  environment fallback that has been live since US-004.
