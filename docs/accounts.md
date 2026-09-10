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

### Putting a password in front of one stack

A staging stack takes registrations (`AUTH_SIGNUP=open`), so anybody who can
reach it may make an account. `docker-compose.staging.yml` puts a password in
front of the whole site, at the proxy, so no request reaches the app without
it. It is a second lock: the app's own login stays behind it.

It is a separate file because `docker-compose.prod.yml` serves every stack. A
middleware added there would prompt on production too. Only the staging deploy
layers this file; production does not.

Make the value on the box and put it in `.env`. `htpasswd` comes from the
`apache2-utils` package on Debian and Ubuntu.

```bash
htpasswd -nbB staging 'the-password'   # prints staging:$2y$05$…
```

```dotenv
TRAEFIK_BASIC_AUTH_USERS=staging:$2y$05$…
```

More users are comma-separated on the one line. **A bcrypt hash starts with
`$2y$`, and the hash goes in `.env` and never in a compose file**: Compose reads
`$` in a compose file as a variable, so a hash written there needs every `$`
doubled. A value from `.env` is inserted as it is.

Start it, or let the next deploy do it:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  -f docker-compose.staging.yml up -d
```

To rotate the password, change the value in `.env` and run the same command.
Nothing in the database changes. To remove the lock, drop the third file from
the command; the next deploy restores it, because the staging workflow passes
it.

`TRAEFIK_BASIC_AUTH_USERS` has no default on purpose. When it is missing the
overlay refuses to render and the stack does not start, rather than starting
without the lock it was asked for.

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

**Opening it changes whose keys pay.** US-081: where signup is open, the keys
in `.env` are the machine's and not an account's, so nothing falls back to
them — not a provider key on a poll, and not a model key on a classification.
Each person who registers pastes their own on the connections and Models
screens, and a job with no key of its own does not run. That is a refusal you
can see: the connections screen shows the key as missing and the monitor form
says the monitor cannot start.

Until US-081 this was advice — *empty the keys out of `.env` before you open
signup* — and advice is a thing somebody skips. It is now the behaviour. You may
still leave the keys in `.env`: with signup open they are simply not offered to
anybody, and switching back to `closed` makes them the fallback again.

What does **not** stop travelling is everything else in `.env`: the provider,
the model, the endpoint and the prices. Those are what this deployment was
configured and measured for, and an account that sets nothing keeps them.
[docs/secrets.md](secrets.md), *Whose key is it*.

**The first account keeps what came before it, and only the first.** See
*Upgrading* below. A second person registering inherits nothing.

By default the email address is an identifier, not a mailbox. Nothing sends
mail to it, so it does not have to be one you can read. The mail this product
*does* send — digests and alerts — is configured separately, inside, and
[docs/notifications.md](notifications.md) covers it.

### Proving the address

`AUTH_EMAIL_VERIFICATION` decides it, and it takes two values.

| | |
|---|---|
| `off` | The default. The address is taken as given, and a session starts the moment the account exists. |
| `required` | A link is sent to the address, and nobody is signed in until they open it. |

**Set it to `required` wherever `AUTH_SIGNUP` is `open`.** Without it anybody
can register with an address they do not own. Three things follow, and they get
worse in that order: they hold that address for ever, because the column is
unique; they take a fresh seven-day trial from an address nobody has to reach,
as often as they like; and the digests meant for the real owner arrive in
their inbox on the first match.

**A key is not a sending domain.** `SMTP_FROM` on a provider's shared testing
domain sends to one address — the mail account owner's — and answers every
other recipient with a 550. The instance still registers those people, still
answers 200, and still tells them to check an inbox the provider refused. Use
an address on a domain you have verified with your provider, and send one probe
to somebody else's address before you trust it.

`required` needs `SMTP_HOST` and `SMTP_FROM`, and **the process refuses to
start without them**. That is the point of the check rather than an
inconvenience: with no mail server the link is never sent, so the instance
would refuse every account it has — yours included — with a message about an
email nobody posted, and no screen would say the mail server was the cause.
[docs/notifications.md](notifications.md) has the SMTP settings; the same ones
carry the digests.

What a person sees:

- Registering says *check your email* and creates no session. It says the same
  thing for an address that is **already registered**, on purpose — an answer
  that said "that address is taken" would tell a stranger which addresses exist
  here, which is one of the three things above. No link is sent in that case,
  so somebody who forgot they had an account waits for mail that is not coming.
  The screen names the possibility and points them at signing in; there is
  nothing better available without giving the enumeration away.
- Signing in before the link is opened is refused, **and sends a new link**.
  That is the whole way back for somebody whose link expired or never arrived;
  there is no resend button and no reset. A wrong password is refused before
  the message goes out, so this cannot be used to mail somebody whose password
  you do not know.
- Opening the link confirms the address and signs the person in.
- A link that expired or was tampered with returns to the login screen with a
  sentence saying so. Links work for 24 hours.

**Turning it on does not lock out the accounts you already have.** Migration
0053 marks every account that existed before this version as verified. They
registered before the rule and cannot be asked retroactively.

**If mail breaks and somebody is stuck**, verify them by hand:

```sql
UPDATE users SET email_verified = true WHERE email = 'them@example.com';
```

That is the whole recovery, and it is why the setting is worth having only on
an instance where somebody watches the mail server.

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

`/api/auth/verify-email` is under `/api/auth/*`, so a confirmation link opens
without a session. It has to: the person clicking it does not have one yet, and
the signed token in the address is the check.

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

There is no password reset, because a reset link that never arrives is worse
than no button at all and the common install has no mail server. The recovery
path is the database, which you own. (`AUTH_EMAIL_VERIFICATION` uses mail when
it is configured, but it confirms an address rather than replacing a password —
it is no help to somebody who has forgotten one.)

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
