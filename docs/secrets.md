# Secrets at rest

What is encrypted, what is not, and how to change the key.

US-004 built this. Read the ticket for why it was built before anything needed
it: the decision about a cipher is a bad one to make in a hurry, on the day the
first key has to move out of a file.

---

## Where a credential lives

Two places, and the store wins.

**The environment.** Every instance today reads its provider keys from `.env`,
one variable per credential field, named `<PROVIDER>_<FIELD>`. This needs no
encryption. The file is already outside the database and outside git, and a
process environment is not a thing a database backup carries.

US-024 changed that name. It used to be `<SOURCE>_<FIELD>`, which was right
while one provider served one platform and wrong the moment one key serves
three: `REDDIT_API_KEY` and `X_API_KEY` would hold the same Bright Data value,
and rotating it would give a person three chances to leave one behind. The old
name is still read, so an instance that upgrades keeps polling, and reading it
logs which line to change, once per process.

**The `source_credentials` table.** Encrypted, keyed by **provider** and field,
and empty on a fresh install. The connections screen writes it. US-023 built
that screen, and it stores a key only after the provider has said the key works
— see *Testing before storing* below.

Keyed by provider for the same reason the variable is named after one: a key
belongs to the account it was issued for, not to the network it is used to
fetch. US-024 re-keyed the table and moved the stored Bright Data key from
`reddit` to `brightdata`, with nobody retyping it.

`worker/credentials.ts` reads the store first and falls back to the
environment, field by field. A half-migrated instance keeps polling.

Storing a key needs `ENCRYPTION_KEY`. Without one the connections screen says
which variable to set and how to generate it, and offers no save; the
environment path still works, and so does testing a key, because a test stores
nothing.

---

## Testing before storing

A key is checked with the provider before it reaches the database, and a key
the provider refuses is never stored.

The reason is a failure that is otherwise invisible. A key that is absent
pauses the monitor and names the variable. A key that is present and *wrong*
passes every check we can make on our own side, starts a monitor, and fails at
the first poll — four retries and a dead letter, at whatever hour the schedule
picked, with the error naming the provider rather than the key.

On Reddit the check is free. `SocialSource.validateCredentials` sends an empty
input list, which cannot start a collection, so the provider refuses a bad key
at 401 before it reads the input.
`sources/providers/brightdata/fixtures/credentials-accepted.json` and
`credentials-rejected.json` are the two real answers, captured, and
`reddit.test.ts` replays both.

Two answers, not one. The provider **refusing** a key and the provider **not
answering at all** lead to different actions, so the routes keep them apart: a
refusal is a 200 carrying `valid: false` and the provider's own sentence, and
an unreachable provider is a 502. A key that could not be tested is not stored
either — the environment variable is the way through a provider outage.

---

## What the encryption is

AES-256-GCM, from Node's own `crypto`. No external key service: a self-hoster
must not need one to run this.

The key is `ENCRYPTION_KEY`, base64 of 32 bytes.

    openssl rand -base64 32

Four properties are worth knowing, because each one is a failure that does not
happen.

**GCM authenticates.** A ciphertext somebody edited fails loudly. CBC would
have decrypted it to noise, and noise is what a connector would then send to a
provider as a key.

**Each value has its own nonce**, stored with it. A nonce is not a secret;
reusing one is what breaks GCM.

**The record's name is authenticated with the value.** A row copied from one
credential into another does not decrypt. Without that, a swap inside the
database is invisible.

**The row carries the name it was sealed with.** `source_credentials.record`
holds it, rather than the code deriving it from the provider and the field. The
reason is US-024: a row written as `reddit:apiKey` cannot be opened as
`brightdata:apiKey`, so a derived name would have refused to start on the very
instance that had a working key. Every write sets the column to the current
name, so a row normalises itself the first time it is replaced or the key is
rotated.

**A value that will not decrypt throws.** It is never an empty string. An empty
credential is four failed calls to a provider and a dead-lettered job, about a
problem nobody can see; a thrown error names `brightdata:apiKey` and a person
can act on it.

---

## What a person is allowed to see

A masked form and nothing else: `••••1234`, the last four characters, and not
even that below eight characters.

The mask is stored in its own column. Showing which key is set therefore
decrypts nothing, and there is no route in the API that returns a stored
credential. `apps/api/src/credentials.test.ts` asserts that against every route
this build registers — the connections routes included — and
`packages/core/src/secrets/leak.test.ts` asserts that a credential logged by
mistake is redacted by the logger before it is written.

The screen sends a typed key in the request body, never in a URL. A key in a
query string reaches the server's access log, the browser history and every
proxy between; `apps/web/src/Connections.test.tsx` asserts it stays out of all
three.

---

## The key is checked at boot

An instance that stores no credential needs no key. That is why
`ENCRYPTION_KEY` is optional, and why `pnpm dev` works on a clean checkout.

An instance that does store one is checked before it accepts any work. The API
and the worker both decrypt every stored row at startup and refuse to start if
they cannot. A missing key, a wrong key or an edited row is a process that will
not boot, with a message naming the record — not a poll that fails at 02:00
with a message about Bright Data.

`ENCRYPTION_KEY` is also checked for shape whenever it is present, even on an
instance that stores nothing, because a truncated paste must not survive to the
first encrypt.

---

## Rotating the key

Manual, on purpose. It is rare, it is not reversible without the old key, and
a wizard that hides those two facts is worse than a list of steps.

Nothing is re-encrypted lazily. Every row moves at once, in one transaction, so
there is no state where some rows are on one key and some on the other.

1. **Back up the database.** The old key is the only way back.

2. **Generate the new key.**

       openssl rand -base64 32

3. **Stop the application.** Both processes, if the worker runs in its own
   container. A process still running holds the old key in memory and will
   write with it.

4. **Re-encrypt, with the old key still in `ENCRYPTION_KEY`:**

       NEW_ENCRYPTION_KEY='<the new key>' pnpm db:rotate-key

   It prints how many credentials it changed. Both keys are read from the
   environment rather than from arguments, so neither lands in a shell history.

5. **Put the new key in `ENCRYPTION_KEY`** and everywhere else that holds it —
   `.env`, the compose environment, your deployment's secret store.

6. **Start the application.** The boot check is the verification step: it
   decrypts every row, so a process that starts is a rotation that worked.

If step 6 fails, the old key still opens the backup from step 1. Restore it and
try again rather than editing rows.

### If the key is lost

The credentials are gone. There is no recovery path, by design — an escrow copy
of the key stored beside the data it protects would be the whole point undone.

Set the credentials again from the provider's dashboard, or move them back to
`.env` while you do.

---

## What this does not cover

- **The model keys.** `AI_API_KEY` and `AI_EMBEDDING_API_KEY` stay in the
  environment. They are per-instance, not per-user, and they never reach the
  database.
- **Postgres itself.** Encryption at rest for the volume, TLS for the
  connection, and who can read a backup are deployment questions. This file is
  about what the application writes, not about where it writes it.
- **A key in a container's environment.** `docker inspect` shows it, and so
  does `/proc`. Moving a credential into the database narrows who can read it
  to somebody with the database *and* the key; it does not narrow it to nobody.

## Notification credentials

`SMTP_PASSWORD` and `WEBHOOK_SIGNING_SECRET` stay in the environment, like model
keys. The API returns readiness and missing variable names, never their values.
The logger redacts both names. Provider error bodies are not retained because
they may echo authentication values or message content. See
[notifications.md](notifications.md) for configuration and signing-key rotation.
