# Accounts, and the port they listen on

SignalScout has one account by default, and a setting that opens registration
for a deployment that wants many. This document says how the first one is
made, what the login protects, and the one thing you must do before the
instance has a public address. The decisions behind it are in
[history.md](history.md) under *Accounts*.

---

## Put it behind TLS before you expose it

The login sends a password over the connection and the session cookie goes
back over every request after it. On plain HTTP both are readable by anything
between the browser and the server, and somebody who reads the cookie is
already signed in. The cookie is marked `Secure` only on an `https` origin.

So: run a TLS terminator in front of it. This repository ships one (below);
Caddy and nginx do the same job in a few lines. Let nothing else reach the
app's port.

**A proxy that terminates TLS and talks to the app over HTTP must send
`X-Forwarded-Proto: https`.** The app reads that header to decide whether the
cookie is `Secure`. Without it a login appears to succeed and then does
nothing, because the browser declines to send back a cookie the app never
marked. Caddy and Traefik send it by default; nginx needs
`proxy_set_header X-Forwarded-Proto $scheme;`.

Set `AUTH_URL` when the address the browser uses is not the one the app sees.
Leave it empty otherwise.

**`403 Invalid origin` on every login** means the browser's `Origin` is not
one this instance trusts. It trusts its own address and whatever
`AUTH_TRUSTED_ORIGINS` lists, comma separated. Set that when the UI is served
from a different origin than the API, or when a proxy rewrites the host but
not the `Origin`. `pnpm dev` needs no entry: the API trusts the Vite server
while `NODE_ENV` is `development`, and never in production. On localhost none
of this applies.

## The proxy this repository ships

`docker-compose.proxy.yml` runs Traefik: it answers on 80 and 443, redirects
HTTP to HTTPS, and gets a certificate from Let's Encrypt.
`docker-compose.prod.yml` stops the app publishing a port on the host, so the
proxy is the only way in. **Both are optional**; an instance already behind
Caddy or nginx should keep it.

Set four values in `.env`: `APP_HOST`, the hostname the browser uses;
`ACME_EMAIL`, where Let's Encrypt sends expiry warnings; `EDGE_NETWORK`, the
Docker network the proxy and the app meet on; `TRAEFIK_NAME`, this stack's
router. Point the hostname's DNS at the box first; the certificate cannot be
issued before the name resolves.

```bash
docker network create signalscout-edge
docker compose -p signalscout-proxy -f docker-compose.proxy.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The proxy is its own compose project, so `down` on the app leaves it and its
certificates running. Let's Encrypt rate-limits issuance, and the `acme`
volume is the only copy.

**If a proxy already runs on this box**, do not start the proxy overlay. Set
`EDGE_NETWORK` to its network and start the app overlay alone; the app
carries its own router labels. Give this stack a `TRAEFIK_NAME` no other
stack uses, or the second to start takes the hostname. The database is never
shared: this product keeps its own Postgres, volume and backup.

---

## The first run makes the account

Start the instance and open it. It asks for a name, an email address and a
password of at least eight characters. **By default, signup closes the moment
that account exists**; a second attempt is refused by the server. There is no
default account and no default password.

`AUTH_SECRET` signs the session cookie and the app refuses to start without
it: `openssl rand -base64 32`. Changing it later signs everybody out and
nothing else.

### Letting other people register

| `AUTH_SIGNUP` | |
|---|---|
| `closed` | The default. One account; every attempt after it is refused. |
| `open` | Anybody who reaches the login screen may register. |

The default is `closed` because an instance that upgraded without anyone
reading the notes must not start accepting registrations.

**Opening it changes whose keys pay** (US-081). Where signup is open, the
keys in `.env` are not offered to any account: each person pastes their own
on the connections and Models screens, and a job with no key does not run,
visibly. The provider, model, endpoint and prices in `.env` still apply to
everyone. `MACHINE_KEYS=instance` is the other shape — an open instance that
pays for its accounts — and [secrets.md](secrets.md), *Whose key is it*,
says what still stays closed to a stranger when the keys do not.

By default the email address is an identifier, not a mailbox. Nothing sends
mail to it. The mail this product does send is configured separately;
[notifications.md](notifications.md).

### Proving the address

| `AUTH_EMAIL_VERIFICATION` | |
|---|---|
| `off` | The default. A session starts the moment the account exists. |
| `required` | A link is sent, and nobody is signed in until they open it. |

**Set it to `required` wherever `AUTH_SIGNUP` is `open`.** Otherwise anybody
can register an address they do not own, hold it for ever (the column is
unique), take a fresh trial from it as often as they like, and receive the
digests meant for the real owner.

`required` needs `SMTP_HOST` and `SMTP_FROM`, and **the process refuses to
start without them**: with no mail server the link is never sent and the
instance would refuse every account, yours included, with no screen naming
the cause. **A key is not a sending domain**: `SMTP_FROM` on a provider's
shared testing domain delivers to one address and answers every other with a
550, while the instance still says *check your email*. Use a domain you have
verified, and send one probe to somebody else's address first.

What a person sees:

- Registering says *check your email* and creates no session. It says the
  same for an address **already registered**, on purpose: "that address is
  taken" would tell a stranger which addresses exist. No link is sent in that
  case, and the screen points them at signing in.
- Signing in before the link is opened is refused **and sends a new link**.
  That is the only way back for an expired or lost link; there is no resend
  button. A wrong password is refused before the message goes out.
- Opening the link confirms the address and signs the person in. Links work
  for 24 hours; an expired or tampered one returns to the login screen with a
  sentence saying so.

Turning it on does not lock out existing accounts: migration 0053 marks every
account from before this version as verified. **If mail breaks and somebody
is stuck**: `UPDATE users SET email_verified = true WHERE email = '...';`.
That is the whole recovery, and why the setting belongs only on an instance
where somebody watches the mail server.

---

## What the login protects

Everything under `/api/` needs a session, with three exceptions:

| Open | Why |
|---|---|
| `/api/auth/*` | It is the login. `verify-email` is under it, because the person clicking a link has no session yet. |
| `/api/health` | A container health check has no cookie, and the answer holds no data. |
| `/api/auth-status` | The login screen asks it whether the instance needs its first account and whether registration is open. |

The built UI is served without a session; it is the page the login form is
on, and everything it shows it fetches through the gate.

**A session lasts seven days**, extended once a day while active. Signing out
deletes the row in `sessions`, so the cookie stops working on the server.

**A key stored in the database belongs to an account; one in `.env` belongs
to the machine**, for provider and model keys alike. Monitors, projects,
matches, verdicts and reply voices are the account's as well.

## Upgrading an instance that already has data

Every row written before this version carried the owner `self-hosted`. The
first account created after the upgrade takes them over — monitors,
projects, reply voices and verdicts — in the same transaction that creates
it. Only the first, enforced by a count: with signup open, a second person
inheriting the owner's monitors is the last thing that should happen.

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
UPDATE webhook_secrets    SET user_id = '<new>' WHERE user_id = '<old>';

-- History, so the spend and poll screens keep answering:
UPDATE api_usage          SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE model_calls        SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE poll_runs          SET user_id = '<new>' WHERE user_id = '<old>';
UPDATE query_estimates    SET user_id = '<new>' WHERE user_id = '<old>';
```

**Check the list is still complete before trusting it**:
`grep -n user_id packages/pipeline/src/db/schema.ts`. It has grown three
times. Two rows are silent when missed: a `source_providers` row left behind
makes a box with two Reddit keys refuse every Reddit collection with nothing
on any screen saying why, and an `ai_keys` row left behind sends every model
call to the instance's key or to failure.

Deleting a user cascades to its sessions and nothing else. A stored key moved
this way keeps working: the ciphertext is authenticated with the record
written into the row, so it decrypts and normalises on its next rewrite.
