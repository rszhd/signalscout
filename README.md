# SignalScout

**Open-source AI intent monitoring.** Find the people publicly talking about
the problem your product solves.

Traditional social listening answers *who mentioned my brand*. SignalScout
answers a different question:

> Who is publicly describing a problem my product can solve?

You describe what you sell, who buys it, and what problems you solve.
SignalScout searches Reddit, X, LinkedIn, YouTube, TikTok and Instagram — posts
and the comments underneath them — and uses a model to read each conversation
and score it: relevance, problem fit, ICP fit, buyer intent, urgency. What you
get is not a dashboard. It is an inbox of people who might need what you build.

---

## Status: it runs, and it has found real people

The pipeline works end to end, on real providers and a real model. A monitor is
created on a form, polled on its own schedule, filtered, scored, and the
matches arrive in an inbox and in your email.

What has happened on live data, not in a test:

- Six platforms have been polled with real keys. Reddit, X, LinkedIn, YouTube,
  TikTok and Instagram all have at least one measured collection behind them.
- The best matches are real. A QA lead with no test automation asking what to
  automate first (71 on Reddit). A person whose skin barrier retinol destroyed
  asking how to treat the scars (90 on Instagram).
- A budget cap has refused a poll that would have spent past it, and the same
  poll's model half stopped mid-batch.
- A digest and an immediate alert have been delivered by email, and a signed
  webhook has been received and verified.

What is not proven, and is written down rather than implied:

- **The scores have five verdicts behind them.** Five matches on one monitor
  were judged by a person, and every kept post scored above every refused one —
  but by six points, and five verdicts is not a distribution.
- **A rate limit has never happened.** Every connector's 429 branch is our half
  of a contract no provider has shown us yet.
- **The hosted version is not up.** There is a staging stack and a Stripe
  product, and no container image on the registry yet. Build it yourself for
  now — see *Running it*.

[PLAN.md](PLAN.md) is the product argument and [STACK.md](STACK.md) is the
engineering one. [`backlog/OPEN.md`](backlog/OPEN.md) is what is being built
and in what order.

---

## How it works

```
Reddit    ─┐
X         ─┤
LinkedIn  ─┤
YouTube   ─┼─► posts and comments ─► keyword ─► embedding ─► triage ─► scoring
TikTok    ─┤                             the three cheap stages    the good model
Instagram ─┘                                                                 │
                                                     relevance · ICP · intent
                                                                             │
                                                                     lead score
                                                                             │
                                  ┌─────────┬─────────┬─────────┬────────────┐
                                inbox     email    webhook     CSV         draft
```

**The cheap stages matter.** A post has to match a word, then clear a
similarity threshold, then survive a one-word question from a cheap model,
before the good model is paid to read it. On keyword noise that removes most of
the bill. Inside a topical subreddit it removes almost nothing, because
everything there is already about the subject — so the arithmetic on the
monitor form assumes the expensive case.

**Nothing is posted from here.** A match has a *Draft reply* button that asks a
model once and puts the text in a box with a copy action. Publishing to a
social network is on PLAN.md's *not building* list, and the feature ends at the
clipboard.

---

## Your accounts, your keys, your data

SignalScout ships the integrations. You own the accounts. Nothing is proxied
through us, and no data leaves your instance.

A key goes in one of two places:

- **In `.env`** — it belongs to the machine, and every account on it polls with
  it. This is the self-hosted shape.
- **On a screen** — *Connections* for the providers that fetch posts, *Models*
  for the ones that read them. It is tested with the provider before it is
  stored, encrypted with `ENCRYPTION_KEY`, and belongs to the account that
  pasted it.

Where `AUTH_SIGNUP=open`, the keys in `.env` are ignored: a stranger who
registers must bring their own, so they cannot spend yours.

### The providers that fetch posts

```env
BRIGHTDATA_API_KEY=      # Bright Data — Reddit
SCRAPECREATORS_API_KEY=  # ScrapeCreators — Reddit
SOCIALCRAWL_API_KEY=     # SocialCrawl — Reddit, X, YouTube, TikTok, Instagram
SOCIALDATA_API_KEY=''    # SocialData — X. Quote it; the key can contain a pipe
APIFY_API_TOKEN=         # Apify — LinkedIn
```

A variable is named after the **provider**, not the platform. One SocialCrawl
key serves five platforms, so it is pasted once and rotated once.
`REDDIT_API_KEY` was the old name for the Bright Data one and is still read, so
an instance that upgrades keeps polling; rename it when you next edit `.env`.

**You only need the providers for the platforms you turn on.** One Reddit key
and one model key are a useful product. A platform with no key cannot be ticked
on the monitor form, and it says which variable is missing.

**Where a platform has two providers, you choose.** Hold one key and there is
nothing to choose. Hold two and the Connections screen asks once and stores the
answer per account; the choice takes effect on the next collection, and a
collection already running finishes at the provider that started it. Until you
choose, a poll refuses to start rather than pick for you — picking would spend
money at a provider you did not.

### The model

```env
AI_PROVIDER=anthropic    # openai | anthropic | google | openrouter | ollama
AI_MODEL=claude-haiku-4-5
AI_API_KEY=              # not needed for ollama
```

That is one provider, chosen in three lines, with no code path per provider.
`ollama` reaches `http://localhost:11434/v1` and needs no key, so a local model
is these lines and nothing else.

This product asks a model four different things, and each is configured on its
own because the right answer differs:

| Job | What it does | Notes |
|---|---|---|
| Scoring | reads a post and scores the lead | the default everything falls back to |
| Triage | one word: could this author be a person to reach? | **must be cheaper than the scoring model** |
| Similarity | embeds posts for the pre-filter | Anthropic publishes no embedding endpoint |
| Drafting | writes a reply draft | the one output that carries your name |

**Triage only saves money when its model is cheaper.** That was measured and it
was a surprise: a one-word answer is not a cheap answer, because a reasoning
model bills its own thinking as output. Over 46 real comments, a scoring model
ten times dearer made the bill 48% smaller; the same model on both stages made
it 48% larger. The worker warns at startup when the two match, and
`.env.example` has a working pair.

Every model call is recorded with its token counts and, where we know the
model's price, what it cost. Where we do not, the record says *we cannot say*
rather than guessing. `AI_INPUT_PRICE_MICROS` and `AI_OUTPUT_PRICE_MICROS`
teach it what your model costs.

---

## What that costs

Honest numbers, because a tool that spends your money should say what it
spends. These are the prices the connectors declare, with the per-post figure
worked out from what one call actually returned when we measured it.

| Platform | Provider | Billed | Price | Per post |
|---|---|---|---|---|
| Reddit | Bright Data | a record | $0.0015 | $0.0015 |
| Reddit | ScrapeCreators | a request | $0.00188 | ~$0.00027 (7–23 posts a request) |
| Reddit | SocialCrawl | a credit | $0.008118 | ~$0.00032 (25 posts) |
| X | SocialData | a tweet | $0.0002 | $0.0002 |
| X | SocialCrawl | a request | $0.008118 | ~$0.0004 (20 posts) |
| LinkedIn | Apify | a post | $0.002 | $0.002 |
| YouTube | SocialCrawl | a credit | $0.008118 | ~$0.00018 (45 videos) |
| TikTok | SocialCrawl | a credit | $0.008118 | ~$0.00027 (30 videos) |
| Instagram | SocialCrawl | a credit | $0.008118 | ~$0.00027 (30 reels) |
| Comments, Instagram | SocialCrawl | 5 credits a page | $0.0406 | ~$0.0027 (15 comments) |
| Embedding pre-filter | your model provider | a call | about $0.00001 a post | |
| Classification | your model provider | a call | about $0.001 a post on a cheap model | |

Four things follow from that table, and each cost money to learn.

**The money is spent at fetch time**, before any filter sees the text. So every
monitor has a monthly cap, every query can be cost-tested before it runs, and
the app shows what it spent. The cap can be overshot by one poll, because the
guard runs before a poll and cannot know what that poll will cost.

**Poll frequency is the dial.** One Reddit keyword through Bright Data costs
$10.80 a month polled hourly and $648 polled every minute. A new monitor starts
at one hour, and the floor is one minute.

**Instagram is the one platform where the provider costs more than the model.**
A search page is one credit and a comment page is five, and the leads there are
in the comments. One live poll spent $1.63 with the provider against $0.33 with
the model, which is the reverse of everywhere else.

**A vague query is not free silence.** X refunds a search that matches nothing.
LinkedIn, YouTube and Instagram do not — they return unrelated results at full
price, and then the model is paid to read them.

Every figure the app shows is an estimate, and
[docs/costs.md](docs/costs.md) lists the ways it is wrong. One day was compared
against Bright Data's own dashboard and read 3.2% high; one X poll matched
SocialData's balance to the micro-dollar.

---

## Why not the platforms' own APIs

**Reddit.** In November 2025 Reddit closed self-serve API registration. Getting
a client id now means a manual approval request under their Responsible Builder
Policy, and developers report rejections for small projects. We are not willing
to ship a product that only works for the people who win an approval. If you
have a client id issued before November 2025 it still works; there is no
connector for it, and an issue asking for one is welcome.

**X.** Its own API sells the same searches at $0.005 per post read with no free
tier — about twelve times what a post costs through SocialCrawl and
twenty-five times SocialData. We chose not to build on it.

**LinkedIn, YouTube, TikTok and Instagram** have no path that gives a small
self-hosted tool a keyword search over strangers' posts.

So every platform arrives through a data provider, and you bring that
provider's key. **Be clear about what that means**, because it is not a free
pass. Your data arrives through a company that is not the platform. You sign
that company's agreement instead of the platform's, and that agreement puts the
compliance burden on you: you warrant that your use violates no third party's
rights, and you indemnify them if it does. The question of whether commercial
monitoring is allowed did not go away. It moved onto you, and it became less
visible.

We think that is the honest trade for an open-source tool, and we would rather
say it here than let you find it in an agreement you skimmed.

### Getting a first key

Bright Data is the shortest path to a working Reddit monitor: a free tier of
5,000 records a month, no card and no company verification.

1. Create an account at [brightdata.com](https://brightdata.com).
2. Open **Settings → API keys** and create one.
3. Put it in `.env` as `BRIGHTDATA_API_KEY=…`, or paste it on the Connections
   screen.

You do not choose a dataset, a scraper or a plan; SignalScout asks for the
Reddit ones by name. A record is one post, and a monitor only spends records
when it runs.

ScrapeCreators and SocialCrawl both give 100 credits free with no card, so
trying a second Reddit provider or a second platform costs nothing.

**A key is tested where it is pasted.** The Connections screen calls the
provider before it stores anything, and a key the provider refuses is never
stored. On most providers that check is free — it is measured, and no billed
row was written for any of the five probes.

---

## Running it

```bash
git clone https://github.com/rszhd/signalscout
cd signalscout
pnpm setup                # writes .env, and the two secrets it cannot ship
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

`pnpm setup` generates `AUTH_SECRET` and `ENCRYPTION_KEY`. Neither can live in
a committed file — a secret in git is a secret every reader of this repository
holds — and the app refuses to boot without the first and refuses to store a
provider key without the second. It never overwrites a value you have already
set, so it is safe to re-run. Then open `.env` and add your keys.

**On a server with no Node**, which is the point of the Docker path, do the
same thing with `openssl`:

```bash
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

Change `POSTGRES_PASSWORD` and `DATABASE_URL` too, before this answers on a
public address.

The app is then on <http://localhost:3000>. It asks you to make the first
account, and refuses every registration after it.

The published image is not up yet, so build it yourself as above; when it is,
`docker compose up` alone will pull it and your server will never compile
anything. One Postgres and one Node process either way, designed to run on a
1 GB VPS.

A new account is asked for two keys before it is given the product — one
provider key to buy the conversations and one model key to read them — because
an account holding neither can do nothing at all.

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
[docs/accounts.md](docs/accounts.md) has both paths, the proxy header you need,
and the way back in if you are locked out.

The worker runs inside the API process by default. To give it its own
container, set `WORKER_IN_PROCESS=false` and `COMPOSE_PROFILES=worker`. It is
the same image either way.

### The settings that decide what kind of instance this is

Three variables separate a machine you run for yourself from one that takes
registrations. All three default to the self-hosted answer, because a version
bump that quietly changed one is the upgrade nobody would forgive.

| | Default | The other value |
|---|---|---|
| `AUTH_SIGNUP` | `closed` — one account, made on the first visit | `open` — anybody may register, and `.env` keys are ignored |
| `AUTH_EMAIL_VERIFICATION` | `off` — the address is taken as given | `required` — a link is sent, and needs SMTP |
| `BILLING_MODE` | `off` — no trial, no paywall, no Stripe | `stripe` — seven free days, then a subscription |

`AUTH_SECRET` is required and the process refuses to start without it: an
instance with no login serves its inbox and its money-spending keys to whoever
finds the port, and every screen works, which is why nobody would notice.
`pnpm dev` writes one into a fresh `.env`.

Set `AUTH_EMAIL_VERIFICATION=required` wherever signup is open. Without it
anybody can register with an address they do not own, and receive the digests
meant for whoever really owns it.

### Notifications

A new monitor is set to notify without being asked: a 24-hour digest at 50 and
up, and an immediate email above 70, to the account that created it. Email is
on only where the deployment can actually send — with no `SMTP_HOST` the screen
names what is missing rather than queueing mail nobody posted. Webhooks stay
off, because they need a URL only you have; every delivery is signed, and
[docs/notifications.md](docs/notifications.md) has the contract a receiver must
implement.

A monitor created before that default existed stays silent until somebody
opens its notification screen and saves.

### When a monitor stops finding things

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

### Working on it

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres, applies the migrations, and runs the API on port
3000, the Vite dev server on 5173 and the worker as a third process. It writes
a `.env` from `.env.example` if you have none.

`pnpm test` needs the same Postgres, because the tests use a real one. No test
reaches a provider or a model: the suite blanks `AI_API_KEY`, so a machine with
a key exported cannot spend one by accident. `pnpm lint`, `pnpm typecheck` and
`pnpm build` need nothing.

---

## What this is not

No sentiment charts, no share of voice, no word clouds, no competitor
analytics, no social publishing, no CRM. Those are good products. They are not
this one.

The scope is one sentence: **find conversations with intent.**

---

## Repository

| | |
|---|---|
| [PLAN.md](PLAN.md) | What we are building, and why |
| [STACK.md](STACK.md) | What we are building it with, and why not the alternatives |
| [docs/sources.md](docs/sources.md) | Adding a platform, adding a provider, switching one off |
| [docs/costs.md](docs/costs.md) | What our spend figure is, and what it is wrong about |
| [docs/secrets.md](docs/secrets.md) | Where a key lives, what encryption promises, how to rotate |
| [docs/accounts.md](docs/accounts.md) | Accounts, TLS, verifying an address by hand, getting back in |
| [docs/billing.md](docs/billing.md) | Who is entitled, what a refused write answers |
| [docs/notifications.md](docs/notifications.md) | SMTP setup and the webhook contract |
| [docs/deletions.md](docs/deletions.md) | How a removed post stops being shown |
| [docs/design.md](docs/design.md) | The shared theme, tokens and controls |
| [docs/spacing.md](docs/spacing.md) | The spacing scale |
| [docs/testing.md](docs/testing.md) | How the tests are written, and what a green suite cannot say |
| [backlog/](backlog/README.md) | One ticket per file; the folder is the status |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repo |

---

## Contributing

The most useful contribution is a source connector. Every source implements one
interface, so adding Hacker News, Bluesky, Mastodon or a forum means one folder
and one registry entry. [docs/sources.md](docs/sources.md) has both lists — a
new provider for a platform we already fetch, and a new platform.

**Not yet, though.** PLAN.md holds one rule above the others:

> Do not add another social network until Reddit and X reliably produce useful
> matches.

A product with two sources that surfaces five genuinely valuable conversations a
day beats one with twenty sources generating hundreds of noisy alerts. Help with
detection quality first.

Six platforms are in the build, and the rule has been crossed four times — each
one on the owner's decision, each one recorded in its ticket rather than left
to look like an oversight. It is still the rule, and a pull request adding a
seventh source meets this same answer.

If you use an AI coding agent, read [AGENTS.md](AGENTS.md) before starting.

---

## License

[Apache-2.0](LICENSE). Use it, change it, run it inside your company, sell a
service built on it. The license adds an express patent grant, which MIT does
not have.

Copyleft was considered and refused, and the reason is worth stating rather than
implying: this product's moat is convenience and not code. The hosted version
charges for not running a server, not for features the self-hosted build lacks,
so a network clause would protect nothing — while many companies ban AGPL
software by policy, which would shut out the exact people meant to be running
this. The argument in full is in
[US-019](backlog/done/2026-09/US-019-the-project-has-a-license.md).

Contributions come in under the [DCO](CONTRIBUTING.md): one `Signed-off-by`
line, no paperwork.
