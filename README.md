# SignalScout

**Open-source AI intent monitoring.** Find the people publicly talking about the
problem your product solves.

Traditional social listening answers *who mentioned my brand*. SignalScout
answers a different question:

> Who is publicly describing a problem my product can solve?

You describe what you sell, who buys it, and what problems you solve.
SignalScout searches Reddit, X and LinkedIn, and uses a model to read each conversation
and score it — relevance, problem fit, ICP fit, buyer intent, urgency. What you
get is not a dashboard. It is an inbox of people who might need what you build.

---

## Status: the skeleton runs, the product does not

`docker compose up` starts Postgres, applies the migrations, and serves the app
on one port. The page you get says the API is alive, and that is honestly all it
says.

The Reddit connector now works: given a key and a query it returns candidate
posts and reports what they cost. Nothing calls it yet. There are no monitors to
run it for, no schedule to run it on, and no classifier to score what it finds,
so the product still does nothing end to end.

If you are here early: [PLAN.md](PLAN.md) is the product argument and
[STACK.md](STACK.md) is the engineering one. [`backlog/OPEN.md`](backlog/OPEN.md)
is what is being built and in what order.

Watch the repository if you want to know when it does something.

---

## How it works

```
Reddit ─┐
        ├─► candidate posts ─► cheap pre-filter ─► AI intent engine
X ──────┘                                                │
                                              relevance · ICP · intent
                                                         │
                                                    lead score
                                                         │
                                              ┌──────────┼──────────┐
                                            inbox      email     webhook
```

The pre-filter matters. Keyword and embedding matching drop the obvious misses
before anything reaches a model, so you are not billed for reading noise.

---

## Your accounts, your keys, your data

SignalScout ships the integrations. You own the accounts.

```env
BRIGHTDATA_API_KEY=      # Bright Data, which serves Reddit
SCRAPECREATORS_API_KEY=  # ScrapeCreators, which also serves Reddit

X_API_KEY=               # optional
X_API_SECRET=

AI_PROVIDER=anthropic    # openai | anthropic | google | openrouter | ollama
AI_MODEL=claude-haiku-4-5
AI_API_KEY=              # not needed for ollama
```

Nothing is proxied through us. There is no SignalScout account to create, no
data leaves your instance, and the AI provider is yours to choose — including
Ollama, if you want no external provider at all. Changing provider is those
three lines; there is no code path per provider and no picker in the UI.

Every model call is recorded with its token counts and, where we know the
model's price, what it cost. Where we do not know the price, the record says so
rather than guessing. Set `AI_INPUT_PRICE_MICROS` and `AI_OUTPUT_PRICE_MICROS`
to teach it what your model costs.

A key is named after the **provider** it belongs to, not the platform it
fetches. One Bright Data key serves every platform Bright Data fetches, so it is
set once and rotated once.

`REDDIT_API_KEY` was the old name and is still read, so an instance that
upgrades keeps polling. It is going: rename it to `BRIGHTDATA_API_KEY` when you
next edit `.env`. The application logs which line to change, once per start.

You only need keys for the providers that serve the sources you turn on. Reddit
alone is a useful product, so one Reddit key and an AI key are enough to start.

**Reddit has two providers, and you need one of them, not both.** Bright Data
bills a record, starting with 5,000 free each month. ScrapeCreators bills a
request, and a request brought back 7 to 23 posts when we measured it, which
makes it much cheaper per post; a new account gets 100 credits with no card.

With one key, SignalScout uses it and asks nothing. With both, the connections
screen shows a row for Reddit and you pick which provider fetches it; the
choice is stored, applies to every monitor, and takes effect on the next
collection. Until you pick, a poll refuses to start rather than choose for you
— choosing would spend money at a provider you did not pick.

### What that costs

Honest numbers, because a tool that spends your money should say what it spends.

| | Cost |
|---|---|
| Reddit, via Bright Data | free for the first 5,000 posts each month, then $0.0015 per post |
| X, via SocialCrawl | £15 buys 2,500 searches; one search returned 20 posts, and a search that finds nothing is refunded |
| Embedding pre-filter | roughly $0.00001 per post |
| Classification | roughly $0.001 per post with a cheap model |

**The money is spent at fetch time**, before any filter sees the text. So every
monitor has a spending cap, every query can be cost-tested before it runs, and
the app shows what it spent.

Reddit is free to start through Bright Data. X is cheaper per post than either
Reddit provider, because a search is charged once whether it brings back twenty
posts or none — so on X the cost follows how often you poll, not how much you
find.

**What one X monitor costs.** One query costs at most two searches per poll.
Polled every six hours that is 240 searches a month, which is £1.44 of the £15
pack — about $1.95. Polled every hour it is £8.64, and polled every minute it
is £518. Three queries cost three times each figure. The poll interval is the
dial, and the cost test on the monitor form does this arithmetic for the
queries you actually wrote before anything starts.

### Reddit comes through Bright Data, and you should know why

In November 2025 Reddit closed self-serve API registration. Getting a client id
now means a manual approval request under their Responsible Builder Policy, and
developers report rejections for small projects. We are not willing to ship a
product that only works for the users who win an approval.

So SignalScout reads Reddit through **Bright Data**, a third-party data
provider, and you bring a Bright Data key. Their free tier covers 5,000 posts a
month and needs no card.

Be clear about what that means, because it is not a free pass. Your Reddit data
arrives through a company that is not Reddit. You sign Bright Data's agreement
instead of Reddit's, and that agreement puts the compliance burden on you: you
warrant that your use violates no third party's rights, and you indemnify Bright
Data if it does. The question of whether commercial monitoring of Reddit is
allowed did not go away. It moved onto you, and it became less visible.

We think this is the honest trade for an open-source tool, and we would rather
say it here than let you find it in an agreement you skimmed.

If you have a Reddit client id issued before November 2025, it still works.
There is no connector for it today. Open an issue if you want one.

**X comes the same way, through SocialCrawl.** X sells the same searches
through its own API at $0.005 per post read, with no free tier, and we chose
not to build on it.

It is a third account, and we would rather it were not. The two providers that
fetch Reddit both offer X, and neither can search it: they fetch the posts of
accounts you name. A monitor exists to find people you have never heard of, so
searching is the whole point. SocialCrawl gives 100 credits free with no card,
which is enough to try X before you decide it is worth another key to look
after.

The same warning applies as for Reddit: your X data arrives through a company
that is not X, under an agreement that puts the compliance burden on you.

#### Connecting it

1. Create an account at [brightdata.com](https://brightdata.com). No card, no
   company verification.
2. Open **Settings → API keys** and create a key.
3. Put it in `.env` as `BRIGHTDATA_API_KEY=…`, or paste it on the Connections
   screen, which tests it with Bright Data before it stores it. The variable is
   named after Bright Data because the key is Bright Data's: the same key
   serves every platform we fetch through them.

That is all. You do not choose a dataset, a scraper or a plan; SignalScout asks
for the Reddit ones by name.

A **record** is one post. The free tier is 5,000 records a month, and a monitor
only spends them when it runs, so a query that finds nothing costs nothing. The
app checks the key before it saves it, and that check is free: it asks Bright
Data to collect an empty list, which authenticates without collecting anything.

---

## Running it

```bash
git clone https://github.com/<user>/signalscout
cd signalscout
cp .env.example .env      # add your keys
docker compose up
```

The app is then on <http://localhost:3000>. It asks you to make the one account
it has, and closes signup behind it.

**Put it behind TLS before you give it a public address.** It holds provider
keys that spend money and an inbox of your own research, and on plain HTTP the
session cookie is readable by anything between you and the server.
[docs/accounts.md](docs/accounts.md) has the proxy header you need and the way
back in if you are locked out.

One Postgres and one Node process. It is designed to run on a 1 GB VPS, and the
image is built in CI, so your server pulls it and never compiles anything.

The worker runs inside the API process by default. To give it its own
container, set `WORKER_IN_PROCESS=false` and `COMPOSE_PROFILES=worker` in
`.env`. It is the same image either way.

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
SELECT monitor_id, source, resume_after, attempts FROM source_continuations;
```

A row in `source_continuations` is normal for a few minutes: Reddit collections
are asynchronous, so a poll starts one, writes down where to come back, and a
later job reads it. A row whose `attempts` keeps climbing is a collection that
never became ready. It is given up after a hundred and twenty tries, and the
next poll asks again.

A job that failed is retried five times with a growing delay, over about an
hour, and then moves to `dead-letter` and stops. That is deliberate: a job that
throws for ever must not keep spending your API allowance while nobody is
watching. Fix the cause, then `SELECT` the row to see what it was.

Poll frequency is a cost dial, not a speed dial. Each monitor carries its own
`poll_interval_seconds`, at least 60, and a shorter interval means more reads
against your key.

There will be a cheap hosted version later, for people who would rather not run
a server. The open-source build will not be crippled to sell it.

### Working on it

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres, applies the migrations, and runs the API on port
3000, the Vite dev server on 5173 and the worker as a third process. It writes
a `.env` from `.env.example` if you have none.

`pnpm test` needs the same Postgres, because the tests use a real one. `pnpm
lint`, `pnpm typecheck` and `pnpm build` need nothing.

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
| [docs/accounts.md](docs/accounts.md) | The one account, TLS, and getting back in |
| [docs/testing.md](docs/testing.md) | How the tests are written, and what a green suite cannot say |
| [backlog/](backlog/README.md) | One ticket per file; the folder is the status |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repo |
| [mockup/](mockup/README.md) | A dependency-free interactive mockup of the UI |

---

## Contributing

The most useful contribution is a source connector. Every source implements one
interface, so adding Hacker News, Bluesky, Mastodon or a forum means one folder
and one registry entry.

**Not yet, though.** PLAN.md holds one rule above the others:

> Do not add another social network until Reddit and X reliably produce useful
> matches.

A product with two sources that surfaces five genuinely valuable conversations a
day beats one with twenty sources generating hundreds of noisy alerts. Help with
detection quality first.

LinkedIn is in the build and it is the exception that proves the rule, not its
repeal: the owner asked for it on 2026-09-05 while the condition was unmet, and
US-028 records that. A pull request adding a fifth source still meets this
answer.

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

Notification setup, including Resend SMTP and signed webhooks, is in
[docs/notifications.md](docs/notifications.md).
