# Secrets at rest

What is encrypted, what is not, and how to change the key. The decisions and
their tickets are in [history.md](history.md) under *Secrets*; this page
holds the rules.

---

## Whose key is it

**A key stored in the database belongs to an account. A key in `.env`
belongs to the machine.** (US-067) A self-hoster puts `SOCIALCRAWL_API_KEY`
and its siblings in `.env`, never opens the connections screen, and every
monitor polls on those keys. An instance taking registrations leaves the
environment empty; each person pastes their own key, and a poll uses the key
of **the owner of the monitor being polled**. An account with no key cannot
start a monitor, and the form names the key it wants.

**Two questions, two variables** (US-161). *Is this instance shared?* is
`AUTH_SIGNUP`. *Whose keys pay?* is `MACHINE_KEYS`, `account` or `instance`;
empty, it takes the answer signup implies — `instance` when closed, `account`
when open. Where the keys are the accounts', `config/machine-keys.ts` strips
the provider and model keys from the environment once, at the composition
root, and every layer below is handed an environment with the keys already
gone; the provider, model, endpoint and prices stay. Two things follow signup
and never the keys policy: a webhook URL is kept off the instance's own
network (US-097), and the instance's `WEBHOOK_SIGNING_SECRET` is nobody's to
sign with (US-096). That is why it is a second variable and not a second
value of the first.

**A model key follows the same rule.** The Models screen stores keys on the
account in `ai_keys`, encrypted the same way. Each of the four jobs —
scoring, triage, similarity, drafting — names one or names none. Every field
on a job is an *override*: an account with no row behaves as if the screen
did not exist. A key states its provider and decides the job's; the card
shows it rather than asking. **A key belongs to nobody's job**: it is added
once and several jobs may name it, and deleting it puts those jobs back on
the instance's key rather than stopping them.

**One key is the default, and every job that says nothing runs on it**
(US-083). The first key an account stores becomes its default; the mark can
be moved. A job with no row runs on the default key, its provider, and the
model `ai/recommended.ts` names for the pair. **Following the default is the
absence of a row**, so changing the default takes effect on the next call and
a job somebody saved is never touched. Two rules stop a call that fails at
02:00: a job stays on the instance when this build names no model for the
pair (DeepSeek, OpenRouter, Ollama, and similarity on anything but OpenAI),
and **deleting the default promotes nothing**.

**A model key is tested before it is stored** (US-087): one small structured
call, recorded in the ledger as `key_test`, with the model to test chosen in
the dialog and not stored. Two refusals come before the probe — no
`ENCRYPTION_KEY`, and a name already taken — because either would throw away
a paid call. An `answered` result stores the key. A job's own Test button
asks a different question: the job's key against the job's model.

**The worker caches a model client per account for the life of the
process.** A model key changed on the screen reaches the API at once and the
worker on its next restart. Provider keys have no cache.

Three things are easy to get wrong later:

- **The record is not the slot.** `credentialRecordName`, what the
  ciphertext is authenticated with, is `user:provider:field`.
  `credentialSlotName`, how a key is spoken about in a "this is missing"
  message, is `provider:field`. The owner is in the first so a row moved
  between accounts with `psql` does not decrypt, and out of the second so a
  message names nobody.
- **The boot check and the rotation are instance-wide, on purpose.**
- **An old row keeps its own record and still decrypts.** `record` is stored
  per row, so changing the naming rule re-encrypts nothing; a row normalises
  the first time it is rewritten or rotated.

---

## Where a credential lives

Two places, and the store wins.

**The environment**: one variable per credential field, `<PROVIDER>_<FIELD>`.
No encryption; the file is outside the database and outside git. The older
`<SOURCE>_<FIELD>` name is still read and logs which line to change, once
per process.

**The `source_credentials` table**: encrypted, keyed by **provider** and
field — a key belongs to the account it was issued for, not to the network it
fetches — and empty on a fresh install. The connections screen writes it,
only after the provider has said the key works. `worker/credentials.ts` reads
the store first and falls back to the environment, field by field, so a
half-migrated instance keeps polling.

Storing a key needs `ENCRYPTION_KEY`. Without one the connections screen says
which variable to set and how to generate it, and offers no save. Testing a
key stores nothing, so it still works.

---

## Testing before storing

A key the provider refuses is never stored. A key that is absent pauses the
monitor and names the variable; a key that is present and *wrong* passes
every check on our side, starts a monitor, and fails at the first poll with
an error naming the provider rather than the key.

`SocialSource.validateCredentials` sends an empty input list, which cannot
start a collection, so the provider refuses a bad key before it reads the
input. **Two answers, not one**: a refusal is a 200 carrying `valid: false`
and the provider's own sentence; an unreachable provider is a 502. A key that
could not be tested is not stored either; the environment variable is the way
through an outage. A model key cannot make that distinction — `ai/call.ts`
answers one `failed` for both — so the Models screen stores nothing either
way and the person retries.

---

## What the encryption is

AES-256-GCM from Node's own `crypto`, no external key service. The key is
`ENCRYPTION_KEY`, base64 of 32 bytes: `openssl rand -base64 32`.

- **GCM authenticates.** An edited ciphertext fails loudly; CBC would decrypt
  it to noise a connector then sends as a key.
- **Each value has its own nonce**, stored with it. Reusing one is what
  breaks GCM.
- **The record's name is authenticated with the value.** A row copied from
  one credential into another does not decrypt.
- **The row carries the name it was sealed with**, in
  `source_credentials.record`, rather than the code deriving it: a derived
  name refused to start on the one instance that had a working key when the
  table was re-keyed (US-024).
- **A value that will not decrypt throws**, naming the record. An empty
  string would be four failed calls and a dead-lettered job about a problem
  nobody can see.

## What a person is allowed to see

`••••1234`, the last four characters, and not even that below eight. The mask
is its own column, so showing which key is set decrypts nothing, and **no
route returns a stored credential**: `apps/api/src/credentials.test.ts`
asserts that against every route this build registers, and
`packages/pipeline/src/secrets/leak.test.ts` asserts the logger redacts a
credential logged by mistake. A typed key travels in the request body, never
a URL; `Connections.test.tsx` asserts it stays out of the access log, the
history and every proxy.

## The key is checked at boot

`ENCRYPTION_KEY` is optional: an instance that stores nothing needs none, and
`pnpm dev` works on a clean checkout. An instance that stores a credential
decrypts every row at startup, in the API and the worker, and refuses to
start if it cannot — a process that will not boot, naming the record, rather
than a poll that fails at 02:00 naming the provider. The key's shape is
checked whenever it is present, so a truncated paste does not survive to the
first encrypt.

## Rotating the key

Manual, on purpose: rare, not reversible without the old key, and every row
moves at once in one transaction.

1. **Back up the database** — [self-hosting.md](self-hosting.md), *Backing
   up*, has the command. The old key is the only way back, so keep the `.env`
   holding it until step 7 has passed.
2. **Generate the new key**: `openssl rand -base64 32`.
3. **Stop the application**, both processes. A running process holds the old
   key and will write with it.
4. **Re-encrypt, with the old key still in `ENCRYPTION_KEY`**:
   `NEW_ENCRYPTION_KEY='<new>' pnpm db:rotate-key`. It prints how many rows
   it changed. Both keys come from the environment, never arguments, so
   neither lands in a shell history. It covers `ai_keys` and
   `webhook_secrets` too.
5. **Put the new key in `ENCRYPTION_KEY`** everywhere it is held.
6. **Start the application.** The boot check is the verification.

If step 6 fails, restore the backup from step 1 and try again; do not edit
rows. **If the key is lost, the credentials are gone.** There is no escrow, by
design. Set them again from the provider's dashboard, or move them back to
`.env` meanwhile.

## What this does not cover

- **The instance's own model keys.** `AI_API_KEY` and `AI_EMBEDDING_API_KEY`
  stay in the environment and never reach the database.
- **Postgres itself.** Encryption at rest, TLS, and who can read a backup are
  deployment questions.
- **A key in a container's environment.** `docker inspect` and `/proc` show
  it. The database narrows who can read a key to somebody with the database
  *and* the key; not to nobody.

## Notification credentials

`SMTP_PASSWORD` stays in the environment: mail is the machine's. **A webhook
signing secret is an account's** (US-096): `webhook_secrets` holds one
encrypted row per account, and an account's own secret wins over
`WEBHOOK_SIGNING_SECRET`, which is stripped where signup is open. One signing
key for the whole instance is BUG-010's shape on another column: any account
could forge a payload another's receiver accepts. We generate the value,
show it in full once, and **derive the record on read** rather than trusting
the row, so a row copied into another account's slot brings its record
along. The API returns readiness and missing variable names, never values;
provider error bodies are not retained. See
[notifications.md](notifications.md).
