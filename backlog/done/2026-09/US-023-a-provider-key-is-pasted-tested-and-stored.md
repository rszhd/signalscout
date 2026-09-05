---
id: US-023
title: A provider key is pasted, tested and stored
type: feature
priority: p1
created: 2026-09-05T14:48+08:00
parent:
area:
resolution: shipped
---

## Context

Two things in this repository are finished and unused, and they are the same
thing seen from two ends.

US-004 built the encrypted credential store: AES-256-GCM, a nonce per value, a
boot check that decrypts every row, a masked read, a rotation command, and
eight deliberate mutations confirmed to turn the suite red. No credential has
ever been stored in it. Every instance still reads `REDDIT_API_KEY` from the
environment, and `worker/credentials.ts` prefers a stored row only when one
exists.

US-010 has one acceptance box open: a monitor with no valid credentials cannot
be started, and says which credential is missing. What is built refuses a
monitor whose source has no key and names the environment variable. It does not
ask the provider whether the key works. The ticket's Notes defer that on
purpose, and they name the place it belongs: next to the field a person pastes
the key into.

That place does not exist. `apps/web` has the monitor form, the inbox and the
monitor list. This ticket adds the fourth screen.

**Why the test is not free to skip.** A key that is present and wrong is worse
than a key that is absent. An absent key pauses the monitor and says so. A
wrong key passes every check we have, starts a monitor, and fails at the first
poll — four retries, then a dead letter, at whatever hour the schedule picked.
`RedditSource.validateCredentials` already answers this, and on Reddit the
answer costs nothing: the probe sends an empty input list, which cannot start
a collection, so a bad key is refused at 401 before the input is read.
`fixtures/credentials-accepted.json` and `credentials-rejected.json` are the
two real answers, so the test path is provable without spending.

**Why the test belongs here and not in the resume path.** US-010 argued this
and it still holds. If a resume validated with the provider, a provider outage
would refuse a resume that has nothing wrong with it. The probe runs where a
person is waiting for its answer and can act on it.

**The boot snapshot is the trap.** `startApi` reads `listCredentialHints` once
and hands `buildServer` a `ReadonlySet` of names. `/api/monitor-options`
reports readiness from that set. Write a credential through a new route and the
running process still says the credential is missing until it restarts. The
snapshot was right when nothing could write; it is wrong the moment something
can. Either the readiness read becomes live, or a write invalidates the
snapshot. Do not add a second source of truth.

**`ENCRYPTION_KEY` is optional today, and this screen needs it.** Nothing can
be stored without a key, so `credentialsFromStore` degrades to the environment
lookup and an instance with no rows needs no key. A save that fails because a
variable is unset is the wrong way for a person to learn this. The screen must
say it before the field is filled, and the rest of the application must keep
working without one.

## Acceptance

- [x] A connections screen lists every registered source, each credential field
      it needs, and whether that field is set
- [x] A key entered on the screen is tested with the provider before it is
      stored, and a key the provider refuses is not stored
- [x] The screen tells the two failures apart: the provider refused the key,
      and the provider could not be reached
- [x] A tested key is stored encrypted through `putSourceCredential`
- [x] A stored key is shown only as a hint. No route returns a plaintext key,
      and no key reaches a log line — asserted, not reviewed
- [x] A stored key can be replaced, and deleted
- [x] Readiness reported by `/api/monitor-options` reflects a key stored in
      this process's lifetime, with no restart
- [x] A monitor paused for a missing credential can be started once its key is
      stored and tested
- [x] With no `ENCRYPTION_KEY`, the screen says which variable to set and how
      to generate it, offers no save, and every other screen still works
- [x] The connection test is asserted against the captured provider answers,
      and no test reaches a real provider

## Notes

- Closes the last box of
  [US-010](US-010-a-monitor-is-created-from-four-answers.md), which
  moves to `done/` with this ticket.
- Gives [US-004](US-004-a-stored-key-is-encrypted-at-rest.md)
  its first writer. US-004's Notes say it becomes p1 the day a key moves out of
  `.env` and into the database. That day is this ticket.
- Read [docs/secrets.md](../../../docs/secrets.md) before touching a credential.
- `packages/core/src/secrets/store.ts` has the whole write side already:
  `putSourceCredential`, `listCredentialHints`, `deleteSourceCredential`. This
  ticket writes no cipher code.
- `SocialSource.validateCredentials` is on the interface US-003 settled. The
  Reddit implementation and its two fixtures are in
  `packages/core/src/sources/reddit/`.
- `credentialRecordName` is the one place a `source:field` name is built. The
  store, the error message and the readiness set all read it. Do not write a
  second one.
- The X connector has never run. Its credential fields are declared, so the
  screen lists them; the probe answer is unproven until somebody has an X key.

## Log

- 2026-09-05T14:48+08:00 — Written. US-010 deferred the connection test to a
  screen that did not exist, and US-004 shipped a store that nothing writes to.
  This is that screen.
- 2026-09-05T15:12+08:00 — Built. `apps/api/src/connections.ts` holds four
  routes and `apps/web/src/Connections.tsx` the screen, with thirty-two new
  tests across the two.

  Three decisions worth keeping.

  **A refusal and an outage are different HTTP answers.** The provider saying
  "this key is wrong" is a 200 carrying `valid: false` and the provider's own
  sentence, because the request worked and the answer is the point. A provider
  that did not answer is a 502. One answer for both would send a person hunting
  for a typo in a key that is correct, and a key that could not be tested is
  not stored either.

  **The boot snapshot became a per-request read.** `startApi` read the stored
  credential names once and handed `buildServer` a set. That was right while
  nothing could write one. It is wrong now: a key stored on this screen would
  be reported missing by the monitor form until a restart. `storedCredentials`
  is a function, read when a request asks.

  **The boot warning moved out of route registration and into `startApi`.**
  Making readiness live made registering a route a database query, and
  `server.test.ts` builds a server over a URL nothing connects to, on purpose.
  Boot is where the database is already known to be reachable, because the
  decrypt check has just read every row of it.

  `App.test.tsx` asserted that no Connections link was on the nav. That
  assertion was correct — the route was a mockup with nothing behind it — and
  this ticket is the change it was guarding. Settings is still a mockup and
  still asserted absent.

  Ten deliberate mutations were applied, five to the routes and five to the
  screen, and every one turned the right file red: storing without asking the
  provider, returning the key instead of the mask, reporting an outage as a
  refusal, writing with no `ENCRYPTION_KEY`, restoring the boot snapshot,
  putting the key in the URL, clearing the field after a refusal, offering a
  remove button for an environment key, offering a save with no encryption key,
  and replacing the provider's reason with a generic line.
- 2026-09-05T15:15+08:00 — **Ran it against Bright Data.** Five probes, and
  `api_usage` recorded nothing for any of them, which is the free-check claim
  measured rather than argued.

  A wrong key was refused in 1.3 seconds with "Bright Data rejected the API
  key. Check REDDIT_API_KEY, or create a new key at brightdata.com under
  Settings, API keys." The real key was accepted in 1.4 seconds. A `PUT`
  carrying the wrong key answered 400 and wrote no row. The real key was
  stored: `v1.6xP92AdQsujccBzR.…`, 93 characters, hint `••••b3e7`, and a
  `like '%<the key>%'` over the table matched zero rows. The log line the write
  emits carries `records: ["reddit:apiKey"]` and a grep for the key over the
  whole log found nothing.

  Then the decisive one. The process was restarted with `REDDIT_API_KEY` unset,
  so the database held the only copy. The screen reported
  `fromEnvironment: false`, `storedHint: "••••b3e7"`, `ready: true`, and a test
  with an empty body — decrypt the stored value, send it to Bright Data —
  answered `valid: true`. Paste, test, encrypt, store, boot-check, decrypt,
  provider accepts. The whole path is now proven on one source.

  One consequence, confirmed by running it: an instance that has stored a
  credential refuses to boot without `ENCRYPTION_KEY`, with
  `MissingEncryptionKeyError` naming `openssl rand -base64 32`. That is US-004
  working as documented, and it means any process started before the key
  existed must be restarted.

  Still unproven: the X connector has never run, so its probe is unmeasured.
  The screen itself was driven only through jsdom — the browser extension was
  not connected, so no real browser has rendered it.
