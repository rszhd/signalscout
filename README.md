# IntentWatch

**Open-source AI intent monitoring.** Find the people publicly talking about the
problem your product solves.

Traditional social listening answers *who mentioned my brand*. IntentWatch
answers a different question:

> Who is publicly describing a problem my product can solve?

You describe what you sell, who buys it, and what problems you solve.
IntentWatch searches Reddit and X, and uses a model to read each conversation
and score it — relevance, problem fit, ICP fit, buyer intent, urgency. What you
get is not a dashboard. It is an inbox of people who might need what you build.

---

## Status: not working yet

**There is no code in this repository.** What exists is the plan, the stack
decision, the testing practice, and 18 tickets.

If you are here early: [PLAN.md](PLAN.md) is the product argument and
[STACK.md](STACK.md) is the engineering one. [`backlog/OPEN.md`](backlog/OPEN.md)
is what is being built and in what order.

Watch the repository if you want to know when it runs.

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

IntentWatch ships the integrations. You own the accounts.

```env
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=

X_BEARER_TOKEN=          # optional

OPENAI_API_KEY=          # or Anthropic, Google, OpenRouter, or a local model
```

Nothing is proxied through us. There is no account to create, no data leaves
your instance, and the AI provider is yours to choose — including Ollama, if you
want no external provider at all.

### What that costs

Honest numbers, because a tool that spends your money should say what it spends.

| | Cost |
|---|---|
| Reddit, free tier | $0 — 100 queries per minute, which is far more than you need |
| X, pay-per-use | $0.005 per post read, no subscription, no free tier |
| Embedding pre-filter | roughly $0.00001 per post |
| Classification | roughly $0.001 per post with a cheap model |

**On X the money is spent at fetch time**, before any filter sees the text. So
every monitor has a spending cap, every query can be cost-tested before it runs,
and the app shows what it spent. About $25 of X credit buys roughly 5,000 post
reads.

Reddit alone is free, and Reddit alone is a useful product.

### Before you connect Reddit

You register your own Reddit application, under your own account, and you accept
Reddit's API terms directly. Read them.

Reddit's free tier is for **personal, non-commercial** use. Commercial
monitoring requires a reviewed contract that starts far above what this tool is
for. Whether your use qualifies is your call to make, not ours — we ship a
connector, you hold the relationship with Reddit.

---

## Running it

Planned, not yet true:

```bash
git clone https://github.com/<user>/intentwatch
cd intentwatch
cp .env.example .env      # add your keys
docker compose up
```

One Postgres and one Node process. It is designed to run on a 1 GB VPS, and the
image is built in CI so your server never compiles anything.

There will be a cheap hosted version later, for people who would rather not run
a server. The open-source build will not be crippled to sell it.

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

If you use an AI coding agent, read [AGENTS.md](AGENTS.md) before starting.

---

## License

Not chosen yet. It will be settled before this repository is made public.

The trade to weigh: a permissive license (MIT, Apache-2.0) maximises adoption,
while a copyleft one (AGPL-3.0) stops a cloud provider running this as a service
without contributing back. Both are defensible for a project with a cheap hosted
tier.
