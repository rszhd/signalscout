# Accounts, and the port they listen on

SignalScout has one account by default, and a setting that opens registration
for a deployment that wants many. This document says how the first one is made,
what the login does and does not protect, and the one thing you must do before
the instance has a public address.

---

## Put it behind TLS before you expose it

**The login sends a password over the connection, and the session cookie goes
back over every request after it.** On plain HTTP both are readable by anything
between the browser and the server: the coffee shop's router, the hotel's
gateway, any hop in between. Somebody who reads the cookie does not need the
password — they are already signed in.

It also matters to the cookie itself. The session cookie is marked `Secure` on
an `https` origin, which tells the browser never to send it over plain HTTP. On
an `http` origin that mark cannot be set, so the cookie travels wherever the
page does.

So: run a TLS terminator in front of it. This repository ships one, and it is
optional — read *The proxy this repository ships* below. Caddy and nginx do the
same job in a few lines if you would rather run your own, and Caddy will get a
certificate on its own. Point it at the app's port and let nothing else reach
that port.

If your proxy terminates TLS and talks to the app over HTTP — which is the
normal arrangement — it must send `X-Forwarded-Proto: https`. The app reads that
header to decide whether the cookie is `Secure`. Without it a login appears to
succeed and then does nothing, because the browser is declining to send back a
cookie the app never marked correctly. Caddy and Traefik send it by default;
nginx needs `proxy_set_header X-Forwarded-Proto $scheme;`.

Set `AUTH_URL` when the address the browser uses is not the one the app sees.
Leave it empty otherwise, which is the common case.

### "Invalid origin"

A login that answers `403 Invalid origin` on every attempt means the browser's
`Origin` is not one this instance trusts. The app compares the two because a
signed-in browser attaches its cookie to any request another site makes it
send, and this check is what refuses those.

It trusts its own address, and whatever `AUTH_TRUSTED_ORIGINS` lists — comma
separated. Set that when the UI is served from a different origin than the API,
or when a proxy rewrites the host but not the `Origin`.

`pnpm dev` is that second shape and needs no entry: Vite serves the UI on 5173
and proxies `/api` to 3000, so the request arrives with the host rewritten and
the browser's own origin intact. The API trusts the dev server on its own while
`NODE_ENV` is `development`, and never in production.

**On localhost, none of this applies.** Nothing leaves the machine.

---

## The proxy this repository ships

`docker-compose.proxy.yml` runs Traefik: it answers on 80 and 443, redirects
plain HTTP to HTTPS, and gets a certificate from Let's Encrypt on its own.
`docker-compose.prod.yml` is the other half — it stops the app publishing a port
on the host, so the proxy becomes the only way in.

**Both are optional.** An instance already behind Caddy or nginx should keep it.
The overlay exists so that the hosted deployment and the documented self-hosted
one are the same mechanism, not because Traefik is simpler for one hostname —
for one hostname it is not.

Set four values in `.env`: `APP_HOST` is the hostname the browser uses,
`ACME_EMAIL` is where Let's Encrypt sends expiry warnings, `EDGE_NETWORK` names
the Docker network the proxy and the app meet on, and `TRAEFIK_NAME` names this
stack's router. Point the hostname's DNS at the box first: the certificate is
issued over that name, so it cannot be issued before the name resolves.

```bash
docker network create signalscout-edge
docker compose -p signalscout-proxy -f docker-compose.proxy.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The proxy is its own compose project, so `down` on the app leaves it and its
certificates running. That is the point of the separation: Let's Encrypt
rate-limits issuance, and the `acme` volume is the only copy.

### If a proxy already runs on this box

Do not start `docker-compose.proxy.yml`. Set `EDGE_NETWORK` to the network that
proxy is on and start the app overlay alone. The app carries its own router
labels, so a Traefik with `exposedbydefault=false` picks it up with no change to
the proxy's own configuration.

Give this stack a `TRAEFIK_NAME` no other stack uses. Two stacks with one name
share a router, and the second one to start takes the hostname.

**The database is not shared, whatever else on the box is.** This product keeps
its own Postgres, its own volume and its own backup. The overlay shares one
network and nothing else.

---

## The first run makes the account

Start the instance and open it. It has no account, so it asks you to make one:
a name, an email address and a password of at least eight characters.

**By default, signup closes the moment that account exists.** A second attempt
is refused by the server, not hidden by the screen. There is no default account
and no default password — an instance nobody has set up yet has an empty `users`
table, and an instance that has been set up has exactly one row in it.

### Letting other people register

`AUTH_SIGNUP` decides it, and it takes two values.

| | |
|---|---|
| `closed` | The default. One account, and the server refuses every attempt after it. |
| `open` | Anybody who reaches the login screen may register. |

Set it to `open` for a deployment where registration is the point. The login
screen then offers "Create an account" beside the sign-in form, and it says
"Set up this instance" only on the very first visit, when there is genuinely
nobody to sign in as.

The default is `closed` and not `open`, because an instance that upgraded into
this version without anyone reading the notes must not start accepting
registrations.

**Read this before you open it.** A provider key stored in the database belongs
to an account, so each person who registers pastes their own on the connections
screen and polls on it. But a key in `.env` belongs to the *machine* and is the
fallback for everybody — so an instance with both a `.env` key and open signup
lets a stranger poll on your key and against your bill. **Empty the provider
keys out of `.env` before you open signup.** [docs/secrets.md](secrets.md),
*Whose key is it*.

The model key is the same shape since US-068: the Models screen stores one per
account for each of the three jobs, and `AI_API_KEY` in the environment is the
fallback for everybody. Empty that too before you open signup, or a stranger's
classifications land on your model bill.

**The first account keeps what came before it, and only the first.** See
*Upgrading* below. A second person registering inherits nothing.

The email address is an identifier, not a mailbox. Nothing sends mail to it, so
it does not have to be one you can read. The mail this product *does* send —
digests and alerts — is configured separately, inside, and
[docs/notifications.md](notifications.md) covers it.

`AUTH_SECRET` is what signs the session cookie. The app refuses to start without
it. Generate one with `openssl rand -base64 32`. Changing it later signs
everybody out and nothing else.

---

## What the login protects, and what it does not

Everything under `/api/` needs a session, with three exceptions:

| Open | Why |
|---|---|
| `/api/auth/*` | It is the login. |
| `/api/health` | A container health check has no cookie, and the answer holds no data. |
| `/api/auth-status` | The login screen asks it whether the instance needs its first account, and whether registration is open. |

The built UI is also served without a session. It has to be: it is the page the
login form is on. It carries no monitor, no match and no key — everything it
shows, it fetches, and every one of those fetches is behind the gate.

**A session lasts seven days**, and an active one is extended once a day, so
daily use never meets the deadline. Signing out deletes the row in `sessions`,
so the cookie stops working on the server rather than only being forgotten by
the browser.

**A key stored in the database belongs to an account; one in `.env` belongs to
the machine.** That holds for provider keys and, since US-068, for model keys
too: a poll uses the keys of the monitor's owner and falls back to the
environment. Monitors, projects, matches, verdicts and reply voices are the
account's as well. [docs/secrets.md](secrets.md), *Whose key is it*, covers the
rule.

---

## Upgrading an instance that already has data

Every row written before this version carried the owner `self-hosted`. The first
account created after the upgrade takes them over — monitors, projects, reply
voices and verdicts — in the same transaction that creates it.

Only the first account does this, and that is enforced by a count rather than
being true by accident. With `AUTH_SIGNUP=open` a second person can register,
and inheriting the owner's monitors is the last thing they should do.

---

## Locked out

There is no password reset, because nothing here sends mail and a reset link
that never arrives is worse than no button at all. The recovery path is the
database, which you own.

With `AUTH_SIGNUP=open` you can simply register again, and then move the rows as
below. With it closed, delete the account first.

Delete the account and let the next visit make a new one:

```sql
DELETE FROM users;
```

The rows the deleted account owned keep its old id, so the account you make next
will not see them. To hand them to the new account, note the old id first and
move them afterwards:

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
UPDATE ai_settings        SET user_id = '<new>' WHERE user_id = '<old>';
```

Deleting a user deletes its sessions with it, which is a cascade in the schema.
It deletes nothing else — including its stored provider keys, which keep the old
id until the `UPDATE` above moves them.

A stored key moved this way keeps working. The ciphertext is authenticated with
the record written into the row, not with a name derived at read time, so a row
whose owner changed still decrypts and normalises the next time it is rewritten
or rotated.
