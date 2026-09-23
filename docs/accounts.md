# Accounts, for the people who change them

> **Running SignalScout rather than changing it?** Sign-up, verification and
> HTTPS are on the site: [accounts](../site/self-hosting/accounts.md) and
> [HTTPS and the proxy](../site/self-hosting/https.md). This page holds the
> rules behind them, for a contributor. The decisions are in the Logs of
> US-017, US-066, US-081 and US-092.

An instance has one account by default, and a setting that opens
registration. Better Auth runs in the same Postgres; `apps/api/src/auth/`
is the code, and the account tables are `apps/api/drizzle`'s stream.

---

## The first run makes the account

The first visit asks for a name, an email and a password of at least eight
characters. **With `AUTH_SIGNUP=closed`, signup closes the moment that account
exists**, and the server refuses every attempt after it. There is no default
account and no default password. `AUTH_SECRET` signs the session cookie, and
the app refuses to start without it.

**Upgrading an instance that already has data.** Rows written before accounts
carried the owner `self-hosted`. The first account created after the upgrade
takes them over — monitors, projects, reply voices, verdicts — in the
transaction that creates it. Only the first, enforced by a count: with signup
open, a second person inheriting the owner's monitors is the last thing that
should happen.

## Who may register, and whose keys pay

Two questions, two variables (US-161):

| Question | Variable | Default |
|---|---|---|
| May a stranger register? | `AUTH_SIGNUP` | `closed` |
| Whose keys pay? | `MACHINE_KEYS` | `instance` when closed, `account` when open |

**Opening signup changes whose keys pay** (US-081). With the default for
`open`, `config/machine-keys.ts` strips the provider and model keys from the
environment once, at the composition root, so no account can spend them;
the provider, model, endpoint and prices stay. `MACHINE_KEYS=instance` is the
other shape: an open instance that pays for its accounts. Two rules follow
signup and never the key policy: a webhook URL is kept off the instance's own
network, and `WEBHOOK_SIGNING_SECRET` is nobody's to sign with
([secrets.md](secrets.md), *Whose key is it*).

The default is `closed` because an instance upgraded without anybody reading
the notes must not start taking registrations.

## Proving the address

`AUTH_EMAIL_VERIFICATION=required` sends a link and signs nobody in until it
is opened. **It belongs wherever signup is open**: without it anybody holds an
address they do not own for ever (the column is unique), takes a fresh trial
from it, and receives the digests meant for the owner.

- **`required` needs `SMTP_HOST` and `SMTP_FROM`, and the process refuses to
  start without them.** With no mail server the link is never sent, and the
  instance would refuse every account, the owner's included, with no screen
  naming the cause.
- **Registering answers the same for a known address**, *check your email*,
  and sends nothing. "That address is taken" would tell a stranger which
  addresses exist.
- **Signing in before the link is opened is refused and sends a new link.**
  It is the only way back for an expired link, so there is no resend button.
  A wrong password is refused before the mail goes out, so this cannot mail
  somebody whose password you do not know.
- Links work for 24 hours. The pipeline's migration 0053 marked every account
  from before the rule as verified.

## What the login protects

**Correctness-critical: the session gate.** Everything under `/api/` needs a
session, with three exceptions:

| Open | Why |
|---|---|
| `/api/auth/*` | It is the login. `verify-email` is under it, because the person clicking a link has no session yet. |
| `/api/health` | A container health check has no cookie, and the answer holds no data. |
| `/api/auth-status` | The login screen asks whether the instance needs its first account and whether registration is open. |

The gate is a claim about *every* route, so its test cannot be a sample:
`apps/api/src/auth.ts` records what it registered, and `auth.test.ts` walks
that list against the written list above. The built UI is served without a
session; everything it shows it fetches through the gate.

**A session lasts seven days**, extended once a day while active. Signing out
deletes the row in `sessions`, so the cookie stops working on the server.

## Behind a proxy

Three rules the code keeps, and the site tells a self-hoster:

- **The cookie is `Secure` only when the request says `https`.** Behind a TLS
  terminator that is `X-Forwarded-Proto: https`; without it a login appears to
  succeed and then does nothing.
- **An origin is trusted** when it is the instance's own address or is listed
  in `AUTH_TRUSTED_ORIGINS`; anything else is `403 Invalid origin`. `pnpm dev`
  needs no entry: the API trusts the Vite server while `NODE_ENV` is
  `development`, and never in production.
- **The sign-in limit counts by the client's address**, and `TRUST_PROXY` says
  which connections may name it in `X-Forwarded-For`. Empty trusts loopback
  and the private networks only (BUG-327).

---

## Locked out

There is no password reset: a reset link that never arrives is worse than no
button, and the common install has no mail server. The recovery path is the
database, which you own. With `AUTH_SIGNUP=open`, register again and move the
rows below. With it closed, delete the account first and let the next visit
make a new one.

```sql
SELECT id FROM users;          -- before deleting: this is <old>

DELETE FROM users;
-- create the new account in the browser, then:
SELECT id FROM users;          -- this is <new>

UPDATE monitors           SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE projects           SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE reply_prompts      SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE feedback           SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE source_credentials SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE source_providers   SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE ai_settings        SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE ai_keys            SET user_id = '<new>' WHERE user_id = '<old>';

-- History, so the spend and poll screens keep answering:
UPDATE api_usage          SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE model_calls        SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE poll_runs          SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE stage_runs         SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE query_estimates    SET user_id = '<new>' WHERE user_id = '<old>';
```

**Check the list is still complete before trusting it**:
`grep -rn user_id packages/pipeline/src/db/schema/`. It has grown four
times. Two rows are silent when missed: a `source_providers` row left behind
makes a box with two Reddit keys refuse every Reddit collection with nothing
on any screen saying why, and an `ai_keys` row left behind sends every model
call to the instance's key or to failure.

Deleting a user cascades to its sessions and its `accounts` row, which holds
the password hash, and nothing else. A stored provider or model key moved
this way keeps working: the ciphertext is authenticated with the record
written into the row, so it decrypts and normalises on its next rewrite.

**The webhook signing secret is not moved.** Its record is derived from the
account on each read, so a row moved to another id does not open. Generate a
new secret on the Notifications screen and put it in the receiver.
