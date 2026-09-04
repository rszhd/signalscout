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

## Status: the skeleton runs, the product does not

`docker compose up` starts Postgres, applies the migrations, and serves the app
on one port. There are no monitors, no connectors and no classifier yet, so
there is nothing to watch and nothing to score. The page you get says the API is
alive, and that is honestly all it says.

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

IntentWatch ships the integrations. You own the accounts.

```env
BRIGHTDATA_API_KEY=      # Reddit

X_API_KEY=               # optional
X_API_SECRET=

OPENAI_API_KEY=          # or Anthropic, Google, OpenRouter, or a local model
```

Nothing is proxied through us. There is no IntentWatch account to create, no
data leaves your instance, and the AI provider is yours to choose — including
Ollama, if you want no external provider at all.

You only need keys for the sources you turn on. Reddit alone is a useful
product, so `BRIGHTDATA_API_KEY` and an AI key are enough to start.

### What that costs

Honest numbers, because a tool that spends your money should say what it spends.

| | Cost |
|---|---|
| Reddit, via Bright Data | free for the first 5,000 posts each month, then $0.0015 per post |
| X, pay-per-use | $0.005 per post read, no subscription, no free tier |
| Embedding pre-filter | roughly $0.00001 per post |
| Classification | roughly $0.001 per post with a cheap model |

**The money is spent at fetch time**, before any filter sees the text. So every
monitor has a spending cap, every query can be cost-tested before it runs, and
the app shows what it spent. About $25 of X credit buys roughly 5,000 post
reads.

Reddit is the cheap source: free to start, and about a third the cost of X after
that. Reddit alone is a useful product.

### Reddit comes through Bright Data, and you should know why

In November 2025 Reddit closed self-serve API registration. Getting a client id
now means a manual approval request under their Responsible Builder Policy, and
developers report rejections for small projects. We are not willing to ship a
product that only works for the users who win an approval.

So IntentWatch reads Reddit through **Bright Data**, a third-party data
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

---

## Running it

```bash
git clone https://github.com/<user>/intentwatch
cd intentwatch
cp .env.example .env      # add your keys
docker compose up
```

The app is then on <http://localhost:3000>.

One Postgres and one Node process. It is designed to run on a 1 GB VPS, and the
image is built in CI, so your server pulls it and never compiles anything.

The worker runs inside the API process by default. To give it its own
container, set `WORKER_IN_PROCESS=false` and `COMPOSE_PROFILES=worker` in
`.env`. It is the same image either way.

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

The argument is written out in
[US-019](backlog/todo/US-019-the-project-has-a-license.md).
