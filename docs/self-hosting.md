# Running your own instance

SignalScout is one Postgres and one Node process. It is designed for a 1 GB
VPS, and the container is the whole application — the open-source build is not
cut down to make a hosted version worth paying for.

This page is the whole install. [README.md](../README.md) is the overview,
[accounts.md](accounts.md) holds the login and the way back in if you are
locked out, and [secrets.md](secrets.md) holds what happens to a key once it is
stored.

---

## Install

```bash
git clone https://github.com/rszhd/signalscout
cd signalscout
pnpm setup                # writes .env, and the two secrets it cannot ship
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

The app is then on <http://localhost:3000>.

**On a server with no Node**, which is the point of the Docker path, do the
same thing with `openssl`:

```bash
cp .env.example.self-hosted .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

### The two example files

`.env.example.self-hosted` is the one you copy, and it is what `pnpm setup`
copies too. It names thirty variables: the two secrets, the Postgres password,
the provider keys, the model settings, SMTP and a few switches. Everything it
leaves out has a default that is already the self-hosted answer, so what it
produces boots.

`.env.example` is the reference. It names every variable the application
reads — sixty-six of them, including the Stripe settings, the proxy names and
the model price overrides — with the reasoning beside each one. Read it when
you want a dial the short file does not offer.

### The two secrets, and why they are not in the file you copied

Both example files are committed, so neither can carry a secret. A secret in
git is a secret every reader of this repository holds.

`AUTH_SECRET` signs the session cookie. **The process refuses to start without
it**, because an instance with no login serves an inbox of commercial research
and a set of money-spending keys to whoever finds the port — and every screen
works, which is why nobody would notice. Changing it later signs everybody out
and does nothing worse.

`ENCRYPTION_KEY` encrypts credentials stored in the database. Without it the
app boots and then refuses to store the keys it asks you for on setup.
**Losing it loses those credentials.** Leave it as generated unless you are
rotating, and read [secrets.md](secrets.md) before you do.

`pnpm setup` never overwrites either one, so re-running it on an instance that
already holds encrypted credentials is safe.

### Change the Postgres password

The example ships `POSTGRES_PASSWORD=intentwatch`. Change it, and
`DATABASE_URL` with it, before this answers on a public address. `pnpm setup`
tells you it is still the default rather than replacing it: changing it on an
instance whose volume already exists locks the app out of its own database.

### The image

`docker compose up` alone pulls a published image so a server never compiles
anything. **That image is not published yet**, so the build command above is
the one to use until it is.

---

## The keys the product runs on

A provider key buys the conversations and a model key reads them. An account
holding neither can do nothing, so a new one is asked for both before it is
given the product.

A key goes in one of two places:

- **In `.env`** — it belongs to the machine, and every account on it polls with
  it. This is the self-hosted shape, and it means nobody ever sees the setup
  screen.
- **On a screen** — *Connections* for the providers, *Models* for the models.
  It is tested with the provider before it is stored, encrypted with
  `ENCRYPTION_KEY`, and belongs to the account that pasted it.

Where `AUTH_SIGNUP=open`, the keys in `.env` are ignored, so a stranger who
registers cannot spend yours.

```env
BRIGHTDATA_API_KEY=      # Bright Data — Reddit
SCRAPECREATORS_API_KEY=  # ScrapeCreators — Reddit
SOCIALCRAWL_API_KEY=     # SocialCrawl — Reddit, X, YouTube, TikTok, Instagram
SOCIALDATA_API_KEY=''    # SocialData — X. Quote it; the key can contain a pipe
APIFY_API_TOKEN=         # Apify — LinkedIn

AI_PROVIDER=anthropic    # openai | anthropic | google | deepseek | openrouter | ollama
AI_MODEL=claude-haiku-4-5
AI_API_KEY=              # not needed for ollama
```

A variable is named after the **provider**, not the platform, so one SocialCrawl
key serves five platforms and is rotated once. You only need the providers for
the platforms you turn on: one Reddit key and one model key are a useful
product, and a platform with no key cannot be ticked on the monitor form.

**Where a platform has two providers, you choose.** Hold one key and there is
nothing to choose. Hold two and the Connections screen asks once and stores the
answer; a collection already running finishes at the provider that started it.
Until you choose, a poll refuses to start rather than pick for you, because
picking would spend money at a provider you did not.

This product asks a model four different things — scoring, triage, similarity
and drafting a reply — and each is configured on its own.
[costs.md](costs.md) says why triage must be the cheaper model, and
`.env.example` carries a working pair with the prices it was measured at.
Anthropic publishes no embedding endpoint, so the similarity stage needs
another provider named or it does not run.

Read [secrets.md](secrets.md) for what encryption promises, and
[sources.md](sources.md) for what each connector fetches.

---

## What kind of instance this is

Three settings separate a machine you run for yourself from one that takes
registrations. All three default to the self-hosted answer, because a version
bump that quietly changed one is the upgrade nobody would forgive.

| | Default | The other value |
|---|---|---|
| `AUTH_SIGNUP` | `closed` — one account, made on the first visit | `open` — anybody may register, and `.env` keys are ignored |
| `AUTH_EMAIL_VERIFICATION` | `off` — the address is taken as given | `required` — a link is sent, and needs SMTP |
| `BILLING_MODE` | `off` — no trial, no paywall, no Stripe | `stripe` — seven free days, then a subscription |

Set `AUTH_EMAIL_VERIFICATION=required` wherever signup is open. Without it
anybody can register with an address they do not own, and receive the digests
meant for whoever really owns it.

[accounts.md](accounts.md) covers letting other people register and proving an
address. [billing.md](billing.md) covers the paywall.

---

## TLS

**Put it behind TLS before you give it a public address.** It holds provider
keys that spend money and an inbox of your own research, and on plain HTTP the
session cookie is readable by anything between you and the server.

```bash
docker network create signalscout-edge
docker compose -p signalscout-proxy -f docker-compose.proxy.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The first runs Traefik, which gets a certificate on its own. The second stops
the app publishing a port on the host, so the proxy is the only way in. Set
`APP_HOST` and `ACME_EMAIL` in `.env` first, and point the hostname at the box.

If Caddy, nginx or another Traefik already fronts this machine, keep it: set
`EDGE_NETWORK` to the network it is on and run the second command alone.
[accounts.md](accounts.md) has both paths and the proxy header a TLS
terminator must send.

---

## The worker

The worker runs inside the API process by default. To give it its own
container, set `WORKER_IN_PROCESS=false` and `COMPOSE_PROFILES=worker`. It is
the same image either way.

---

## Notifications

A new monitor notifies without being asked: a 24-hour digest at 50 and up, and
an immediate email above 70, to the account that created it.

Email is on only where the deployment can actually send. With no `SMTP_HOST`
the screen names what is missing rather than queueing mail nobody posted.
Webhooks stay off, because they need a URL only you have.

A monitor created before that default existed stays silent until somebody opens
its notification screen and saves. [notifications.md](notifications.md) has the
SMTP setup and the contract a webhook receiver must implement.

---

## When a monitor stops finding things

The queue is tables in your own Postgres, so looking at it is SQL and needs no
extra tool.

```sql
-- What is waiting, running or failing, per queue.
SELECT name, state, count(*) FROM pgboss.job GROUP BY name, state;

-- Jobs that failed every attempt. They stop here; nothing retries them.
SELECT source_name, created_on, output FROM pgboss.job
WHERE name = 'dead-letter' ORDER BY created_on DESC LIMIT 20;

-- Is the scheduler's clock running?
SELECT * FROM pgboss.schedule;

-- When each monitor was last polled, and how often it asks to be.
SELECT name, last_polled_at, poll_interval_seconds FROM monitors;

-- Collections a source has started and nobody has read yet.
SELECT monitor_id, source, provider, resume_after, attempts FROM source_continuations;

-- What has been spent this month, per platform and provider.
SELECT source, provider, sum(estimated_cost_micros) / 1000000.0 AS dollars
FROM api_usage WHERE day >= date_trunc('month', now() AT TIME ZONE 'UTC')
GROUP BY source, provider;
```

A row in `source_continuations` is normal for a few minutes: some collections
are asynchronous, so a poll starts one, writes down where to come back, and a
later job reads it. A row whose `attempts` keeps climbing is a collection that
never became ready. It is given up after a hundred and twenty tries, and the
next poll asks again.

A job that failed is retried five times with a growing delay, over about an
hour, and then moves to `dead-letter` and stops. That is deliberate: a job that
throws for ever must not keep spending your API allowance while nobody is
watching. Fix the cause, then `SELECT` the row to see what it was.

**Poll frequency is a cost dial, not a speed dial.** Each monitor carries its
own `poll_interval_seconds`, at least 60, and a shorter interval means more
reads against your key. [costs.md](costs.md) has the arithmetic.

---

## Working on the code

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres, applies the migrations, and runs the API on port
3000, the Vite dev server on 5173 and the worker as a third process. It calls
the same `.env` bootstrap `pnpm setup` does, so the two paths cannot drift.

`pnpm test` needs the same Postgres, because the tests use a real one. No test
reaches a provider or a model: the suite blanks `AI_API_KEY`, so a machine with
a key exported cannot spend one by accident. `pnpm lint`, `pnpm typecheck` and
`pnpm build` need nothing. [testing.md](testing.md) says how the tests are
written and what a passing suite cannot say.
