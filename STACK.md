# Tech Stack

Companion to [PLAN.md](PLAN.md). PLAN.md says what we build. This says what we
build it with, and why. What each platform and provider was measured doing is
in [docs/history.md](docs/history.md); this page holds the choices.

## Constraints that decided everything

1. **Self-hostable in one command.** `docker compose up` must work. Every
   extra service is a service a self-hoster must run and we must debug.
2. **Runs on a budget server.** A 1 GB VPS is the target.
3. **Small team, moving fast, written with AI assistants.** Mature, widely
   documented tools produce better generated code than clever new ones.
4. **Easy to debug.** When something breaks at 02:00 we read the SQL; we do
   not guess what a framework did.

Three rules follow: **one language** (TypeScript everywhere), **one database**
(Postgres holds rows, the job queue and the vectors), **two processes** (an
API server and a worker, optionally one).

---

# The stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS | One language for API, worker and connectors. |
| Language | TypeScript, strict | Types catch AI-written mistakes before runtime. |
| Frontend | React + Vite, static build | No server rendering. The app is behind a login, so SEO does not apply. |
| Routing | React Router, with every address in `apps/web/src/route.ts` | One table of patterns and builders; no address written as a string beside a link. |
| UI | Tailwind, and one shared theme in `styles/tokens.css` and `styles/theme.css` | Colors and sizing in one place; page layout stays in the page. |
| API | Fastify | Mature, fast, small footprint, `pino` logging built in. |
| Validation + docs | `fastify-type-provider-zod` | One Zod schema gives request validation, TypeScript types and an OpenAPI spec. |
| Static files | `@fastify/static` | The API process serves the built UI. No nginx container. |
| Database | Postgres 17+ with `pgvector` | Rows, queue and embeddings in one service. |
| ORM | Drizzle | Migrations are plain SQL files. The generated query is readable. |
| Queue + cron | `pg-boss` | Retries, scheduling and dead letters inside Postgres. No Redis. |
| AI calls | Vercel AI SDK | One API over OpenAI, Anthropic, Google, DeepSeek, OpenRouter and Ollama. `generateObject` with a Zod schema returns the score already parsed and validated. |
| Schemas | Zod | AI structured output, API input and env vars from one definition. |
| Auth | Better Auth | Sessions in our own Postgres. No external service. |
| Email | Nodemailer over SMTP | Self-hosters need SMTP. Hosted providers are another SMTP target. |
| Secrets at rest | Node `crypto`, AES-256-GCM | Keys encrypted under `ENCRYPTION_KEY`; [docs/secrets.md](docs/secrets.md). |
| Tests | Vitest, and jsdom for a screen | Real Postgres from the first file. No browser engine. |
| Lint + format | Biome | One tool, one config file. |
| Packaging | pnpm workspaces | Add Turborepo only when builds get slow. |
| Deploy | Docker Compose, one image, built in CI | Postgres, API, worker. A self-hoster compiles nothing. |

---

# Repository shape

```
apps/
  api/          Fastify: REST endpoints, serves the built UI
    auth/       Better Auth, and who owns a row
    db/         the account tables and their own migration stream
    worker.ts   the same worker as a process of its own
  web/          Vite + React: the intent inbox

packages/
  engine/       stateless: input in, result and cost out
    sources/    platforms.ts, and providers/<provider>/<platform>.ts
    ai/         providers, prompts, classification schema, triage
    filter/     the keyword stage of the pre-filter
    estimate/   the cost test's arithmetic
    secrets/    the cipher
    vocabulary.ts  platforms, providers, signals, intents, two defaults
  pipeline/     stateful: owns its tables and the jobs, imports the engine
    db/         Drizzle schema and migrations, the pipeline's stream
    worker/     the job steps the worker process registers, and the gate
    budget/     the cap, and what a poll is allowed to spend
```

## The one rule

**`packages/engine` is stateless, `packages/pipeline` owns only its tables,
and neither knows an account.** The engine declares no database, queue, auth
or payment dependency, imports nothing from another package, and reads no
environment variable. The pipeline imports the engine and never the reverse,
imports neither Fastify, React, Better Auth nor Stripe, and knows an owner as
a text id. Login and who may poll are `apps/api`'s; billing is the hosted
application's, in its own repository. This keeps the business logic testable
with plain Vitest, stops a UI concern from leaking into a connector, and is
what a second application builds on (US-151). When an AI assistant proposes
a change that breaks this rule, reject it.

---

# Why these choices, and not the obvious ones

**Not Next.js.** Its production build fails on a 1 GB VPS and its server
spends CPU rendering every request. A static Vite bundle plus Fastify renders
nothing, and an app behind a login does not need server rendering.

**Not Redis.** `pg-boss` stores jobs in Postgres tables, so a stuck job is a
`SELECT`, and there is no second service to run, back up and inspect.

**Drizzle, not Prisma.** Prisma hides the SQL behind a query engine binary.
Drizzle generates SQL we can paste into `psql`. We chose debuggability.

**No Python.** It would help only if we ran local models ourselves, and users
bring their own keys. Every provider is plain HTTP.

---

# Source economics

The cost of a post shapes the design more than any framework choice. The
prices are in [docs/costs.md](docs/costs.md) and what each provider bills is
in [docs/sources.md](docs/sources.md). Four properties decide the
architecture:

**The money is spent before our code sees the text.** Every fetch is billed
whatever a filter later does with the post. The budget guard is built on
this, and it is why the cost test exists: no stage after collection can save
a person from a query that is too broad.

**A credit is not a request.** One SocialCrawl credit costs the same on every
platform and a call spends one on X and five on LinkedIn, so a connector
reports `unitsConsumed` in the unit its own price is written against, and
comments that cost more than posts get `replyPricePerUnitMicros`.

**A search that finds nothing is not always free.** Some endpoints refund it;
most bill in full and return unrelated results, which the model is then paid
to read.

**Where the lead is in the comments, the bill moves to the comments.** On
YouTube, TikTok and Instagram a search returns people who post to be seen,
and the person worth reaching is underneath. On Instagram the provider costs
more than the model.

## A source is not a provider

> **A platform and a provider are separate records, and a connector is the
> pair.** US-024, reversing what this page said until 2026-09-05.

A **platform** is what a person ticks; it keys `posts.source` and
deduplication. A **provider** is who fetches, whose key it is, and what it
bills; price, billable unit, poll ceiling and credential fields live here.
The connections screen is keyed by provider, because one key serves several
platforms.

**Do not weaken `SocialSource` to fit a provider.** It already carries
`unitsConsumed` and `next`, so a provider that bills per record and answers
asynchronously fits without a new member. If a provider does not fit, it is
the provider we describe wrongly. Nothing downstream of a connector learns
which provider answered.

**A price belongs to the pair, never to the platform.** **A post is one post
however many providers fetched it**: `posts.provider` is attribution only and
stays out of `UNIQUE (source, external_id)`.

## The platforms

**Reddit's self-serve API is closed** since November 2025, so Reddit is
reached through a data provider whose key the user brings: ScrapeCreators or
SocialCrawl. **Comments cannot be discovered by keyword**, only collected by
post URL, so a monitor that wants comments pays a second call per post.
**Collection may be asynchronous**: a snapshot id to poll is
`next: { status: "wait" }` with the id as the cursor.

**The terms question moved rather than disappeared**: a provider's agreement
makes the *customer* warrant lawful use. Bring-your-own-key keeps this
repository clear of it; pooling data across users would not. The hosted
version's position is a legal question, not an engineering one.

**X is reached through a data provider, not through X's own API**, decided
2026-09-05. X's pay-per-use tier bills $0.005 a read, and that number
describes X and nobody else: `pricePerUnitMicros` comes from the provider
that sends the bill. Before adding a provider for a platform, ask whether it
can discover a stranger, not only whether it can fetch a URL; two of three
candidates could not. Per-read billing is why the budget guard landed before
the X connector.

**LinkedIn is fetched through Apify, and the SocialCrawl connector is
switched off** (US-053, US-057): half the price and fresher by days. Apify is
a marketplace, not a data API: the actor can change under us, so re-run the
capture rather than trust a fixture for ever, and its bill settles *after*
the run ends. LinkedIn's noise is articles *about* the problem, which no
cheap stage can tell from a question.

# What the economics add to the build

All five are built; read them as why the code looks the way it does.

- **Query precision is a cost lever**, so the monitor form samples each
  query and quotes a month before the monitor starts.
- **Never pay for the same post twice**: a re-read window is a charge on
  somebody's card, which is why cursors and deduplication are a
  correctness-critical surface.
- **Budgets belong in the data model**: `api_usage` per monitor, pair and
  day; a monthly cap on the monitor; the guard before a poll.
- **The throttle is the connector's to respect**: it backs off in the
  provider's own dialect and hands back `next: { status: "wait", retryAfter,
  cursor }` when the wait is longer than a job should hold.
- **Deletions are honoured**: an id and a short excerpt, never a permanent
  copy, and a reconciliation job ([docs/deletions.md](docs/deletions.md)).

---

# The pre-filter

Three stages between collection and the model: a free keyword and subreddit
match; embedding similarity with `pgvector`; and triage, one question to a
cheap model. The third exists because the first two measure *subject*, and no
similarity threshold separates a person asking from the experts answering
under them. **Triage saves money only when its model is cheaper than the
classifier's.** Every drop is written to `filter_drops`, and only an explicit
refusal drops an item.

---

# Deployment

**The image is built in CI and pulled**, so build memory is not a server
question and a self-hoster compiles nothing. **`pg-boss` is a library, not a
service**, so on a small machine the worker runs inside the API process:
`WORKER_IN_PROCESS=true` is one Node process at about 120 MB; `false` is a
separate worker container from the same image. Compose runs `postgres`,
`app` and, optionally, `worker`.

**The hosted product is a separate, private repository since 2026-09-16.** It
depends on `@signalscout/engine` and `@signalscout/pipeline` from npm at one
pinned version and carries its own API, screens, onboarding, plans and
Stripe. This repository holds no billing code and the scheduler is handed a
gate that admits everyone. What stays shared is what has the bugs worth
sharing: every connector, every model call, the budget guard, deduplication
and the scheduler, tested once here and released as a version
([docs/releasing.md](docs/releasing.md)).

---

# What we are not using

| Not using | Instead |
|---|---|
| Next.js | Vite static build + Fastify |
| Redis / BullMQ | `pg-boss` in Postgres |
| Kafka, Temporal, Kubernetes | Docker Compose |
| A separate vector database | `pgvector` |
| Prisma | Drizzle |
| Python | TypeScript |
| A managed auth service | Better Auth in our own Postgres |
| nginx container | `@fastify/static` |
| tRPC | REST with an OpenAPI spec, so any language can call it |
