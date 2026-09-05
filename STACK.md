# Tech Stack

Companion to [PLAN.md](PLAN.md). PLAN.md says what we build. This says what we
build it with, and why.

## Constraints that decided everything

1. **Self-hostable in one command.** `docker compose up` must work. Every extra
   service is a service a self-hoster must run and we must debug.
2. **Runs on a budget server.** A 1 GB VPS is the target. Not a Kubernetes
   cluster.
3. **Small team, moving fast.** Written with AI assistants. Mature, widely
   documented tools produce better generated code than clever new ones.
4. **Easy to debug.** When something breaks at 2am, we want to read the SQL, not
   guess what a framework did.

Three rules follow from these:

* **One language.** TypeScript everywhere.
* **One database.** Postgres holds rows, the job queue, and the vectors.
* **Two processes.** An API server and a worker. Optionally one.

---

# The stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS | One language for API, worker, and connectors. |
| Language | TypeScript, strict | Types catch AI-written mistakes before runtime. |
| Frontend | React + Vite, static build | No server rendering. The app is behind a login, so SEO does not apply. |
| Routing | React Router | Mature and widely known. |
| Data fetching | TanStack Query | Caching, retries, and refetch for the inbox. |
| UI | Tailwind + shadcn/ui | Components are copied into the repo. We own the code, so we can edit it. |
| API | Fastify | Mature, fast, small footprint, `pino` logging built in. |
| Validation + docs | `fastify-type-provider-zod` | One Zod schema gives request validation, TypeScript types, and an OpenAPI spec. |
| Static files | `@fastify/static` | The API process serves the built UI. No nginx container. |
| Database | Postgres 17+ with `pgvector` | Rows, queue, and embeddings in one service. |
| ORM | Drizzle | Migrations are plain SQL files. The generated query is readable. |
| Queue + cron | `pg-boss` | Retries, scheduling, and dead letters inside Postgres. No Redis. |
| AI calls | Vercel AI SDK | One API over OpenAI, Anthropic, Google, OpenRouter, and Ollama. |
| Schemas | Zod | AI structured output, API input, and env vars from one definition. |
| Auth | Better Auth | Sessions in our own Postgres. No external service. |
| Email | Nodemailer over SMTP | Self-hosters need SMTP. Hosted providers are just another SMTP target. |
| Secrets at rest | Node `crypto`, AES-256-GCM | User API keys are encrypted with a key from `ENCRYPTION_KEY`. Optional while keys live in `.env`; see [docs/secrets.md](docs/secrets.md). |
| Tests | Vitest + Playwright | Vitest for core logic. Playwright for the inbox flow. |
| Lint + format | Biome | One tool, one config file. |
| Packaging | pnpm workspaces | Add Turborepo only when builds get slow. |
| Deploy | Docker Compose, one image | Postgres, API, worker. |

---

# Repository shape

```
apps/
  api/          Fastify: REST endpoints, serves the built UI
  web/          Vite + React: the intent inbox
  worker/       pg-boss: collect, filter, classify, notify

packages/
  core/
    sources/    reddit/, twitter/      SocialSource implementations
    ai/         providers, prompts, classification schema
    db/         Drizzle schema and migrations
    services/   collector, classifier, scheduler, notifications
    billing/    usage metering and budget guards
```

## The one rule

**`packages/core` imports neither Fastify nor React.**

The API and the worker both call into it. This keeps the business logic testable
with plain Vitest, and it stops a UI concern from leaking into a connector.

When an AI assistant proposes a change that breaks this rule, reject it.

---

# Why these choices, and not the obvious ones

## Not Next.js

A Next.js production build often needs more than 2 GB of memory. It fails on a
1 GB VPS. The standalone server then holds 150-250 MB at idle and spends CPU
rendering on every request.

A static Vite bundle plus Fastify holds around 70-120 MB and spends no CPU on
rendering. We give up server rendering. We do not need it, because the whole
application sits behind a login.

The marketing site is a separate static site on a CDN. It does not live in this
repository.

## Not Redis

`pg-boss` is a library that stores jobs in Postgres tables. Debugging a stuck job
is a `SELECT`. With Redis and BullMQ we would run a second service, back it up
separately, and inspect it with a separate tool.

At our scale — a few thousand posts per day — Postgres is enough for years.

## Drizzle, not Prisma

Prisma has more documentation, so assistants make fewer mistakes with it. But
Prisma runs a query engine binary and hides the SQL.

Drizzle generates SQL we can read and paste into `psql`. We chose debuggability.

## The AI SDK, not raw provider SDKs

Use `generateObject` with a Zod schema for the classifier. The model returns the
scoring JSON already parsed and validated. Swapping OpenAI for Ollama is a
one-line change.

This single choice covers the whole multi-provider section of PLAN.md.

## No Python

Python would only help if we ran local embedding or classification models
ourselves. We do not. Users bring their own AI keys.

Reddit, X and Bright Data are plain HTTP, so `fetch` is enough. PRAW and Tweepy
add nothing, and `snoowrap` is unmaintained.

Add a small Python service later only if we ship a local model.

---

# Source economics

The cost of a post is not evenly spread across the pipeline. This shapes the
design more than any framework choice.

| Step | Cost per post |
|---|---|
| Reddit read, Bright Data free allowance | $0, first 5,000 records each month |
| Reddit read, Bright Data pay-as-you-go | $0.0015 ($1.50 per 1,000 records) |
| X read, pay-per-use | $0.005 |
| Embedding pre-filter | ~$0.00001 |
| AI classification, cheap model | ~$0.001 |

**Fetching an X post costs about five times more than classifying it.** The money
is spent before our code ever sees the text. Reddit through Bright Data costs
about a third of an X read, and starts free, so Reddit still carries the MVP.

## A source is not a provider

Reddit taught us this the hard way, so the rule is written down before it is
needed again:

> **The architecture supports replaceable providers. The product offers one
> provider per source.**

A user connects *Reddit*, not *a Bright Data Reddit scraper*. The UI names the
provider in secondary text, because a user routed through a third party must be
told so, but it never asks them to choose one. Internally the provider is a
`SourceDefinition` like any other, so replacing it changes no monitor, no score,
no match and no notification.

This is why `SocialSource` already carries `unitsConsumed` and `next`: a
provider that bills per record and answers asynchronously fits it without a new
member. Do not weaken that interface to accommodate a provider. If a provider
does not fit, it is the provider we describe wrongly, not the interface.

## Reddit

**Reddit's self-serve API is closed.** Since its Responsible Builder Policy in
November 2025, registering a script or web app requires a manual approval
request. Reports from developers describe rejections for small projects and
long silences. Keys issued before the policy are grandfathered and still work.

An open-source product cannot ask every self-hoster to win an approval. So
Reddit is reached through **Bright Data**, and the user brings a Bright Data key
instead of a Reddit one.

| | Cost | Allowance |
|---|---|---|
| Bright Data free tier | $0 | 5,000 records per month, no card |
| Bright Data pay-as-you-go | $1.50 per 1,000 records | no minimum, no commitment |

Two facts shape the connector:

**Comments cannot be discovered by keyword.** Posts are discovered by keyword or
by subreddit. Comments are collected *by post URL only* — the same limit Reddit's
own API has. So a monitor that wants comments pays a second call per post, and
the cost per monitor roughly doubles. This is a product decision, not a default.

**Collection is asynchronous.** A small request answers within about a minute.
A larger one returns a `snapshot_id` to poll. That is `next: { status: "wait" }`
with the snapshot id as the cursor; the scheduler does other work meanwhile.

Access is not gated. Bright Data's free tier needs no card, no company
verification and no KYC review; only their proxy products are excluded, and we
use none. That was checked rather than assumed, because an unverified access
claim is what cost us Reddit.

The terms question does not disappear by changing provider — it moves. Bright
Data's Master Service Agreement makes the *customer* warrant that their use
violates no third-party rights, and indemnify Bright Data if it does. So the
question of whether commercial Reddit monitoring is allowed now sits with the
user, less visibly than before. Say that in the README rather than implying a
third party absorbed it.

Two clauses to re-read before the hosted launch, not before the connector:

- A customer may not redistribute collected data "to offer a similar or
  competitive product". Bring-your-own-key keeps us clear of this, because each
  user's own account collects their own data. Pooling data across users would
  not be clear of it.
- The customer is solely responsible for the lawful grounds for personal data.
  An author handle is personal data under GDPR, and we store one.

The hosted version's position is still a legal question, not an engineering
one.

## X

Pay-per-use, and since February 2026 that is the only self-serve path: Basic and
Pro are closed to new signups, and there is no free tier. $0.005 per post read,
no monthly minimum. Roughly $25 buys 5,000 reads, or about 165 posts per day.

**No free tier plus per-read billing makes the budget guard a prerequisite, not
a follow-up.** US-013 and US-014 land before the X connector, not after it.

---

# What the economics add to the build

## 1. Query precision is a cost lever

PLAN.md says the system generates search queries so users avoid Boolean syntax.
That is a billing feature, not only a usability feature. A loose query burns
budget on posts the filter will discard.

Add a **test this query** step that shows the match count and the estimated cost
before a monitor starts running.

## 2. Never pay for the same post twice

Keep a `since_id` per query and always send it. Add a unique constraint:

```sql
UNIQUE (source, external_id)
```

A bug that re-reads a window is not a duplicate row problem. It is a charge on
the user's card.

## 3. Budgets belong in the data model

```
api_usage   monitor_id, source, day, reads, estimated_cost_cents
budget      monitor_id, monthly_cap_cents, on_exhausted (pause | notify)
```

The worker checks the budget before each poll and refuses to run when the cap is
reached. Show remaining spend next to each monitor in the UI.

For a bring-your-own-keys product this is a trust feature. Users will not connect
a metered API key to software that cannot report what it spent.

`pg-boss` supports throttled jobs, so the poll interval per monitor becomes a
cost dial we can set from the UI.

## 4. Respect the provider's throttle

Every provider says "slow down" in its own dialect. Reddit's own API sends
`X-Ratelimit-Remaining` and `X-Ratelimit-Reset`; Bright Data answers a large
request with a `snapshot_id` to poll; X sends neither. Read that signal in the
connector and back off there. Do not poll on a fixed timer and hope.

Put this in the connector's own folder, not in the worker, so every caller gets
it and no caller learns how the connector found out. `NextPage` is the whole
vocabulary the caller needs.

## 5. Honor deletions

Reddit requires that content the author removed stops being shown. This does
not soften because the data arrived through a third party.

Store the post ID and a short excerpt, not a permanent full copy. Run a
reconciliation job that re-checks matched posts and hides the deleted ones.

Add `last_verified_at` to the matches table now. Retrofitting this is painful.

---

# The pre-filter

PLAN.md puts a cheap pre-filter between collection and the AI engine. Build it in
two stages, both inside Postgres.

1. **Keyword and subreddit match.** Free.
2. **Embedding similarity with `pgvector`.** Embed the monitor description once.
   Embed each candidate post. Drop everything below a cosine threshold.

An embedding call costs about one hundredth of a classification call. This is
what keeps a user's AI bill low, and a low bill is our positioning.

---

# Deployment

## Build in CI, not on the server

Build the image on GitHub Actions. Push it to a registry. The server only pulls
and runs.

Build memory then stops being a server question. Self-hosters pull a published
image instead of compiling anything.

## Single-process mode

`pg-boss` is a library, not a service. On a small machine, run the worker inside
the API process.

```env
WORKER_IN_PROCESS=true    # one Node process, ~120 MB
WORKER_IN_PROCESS=false   # separate worker container, scale later
```

Same image, same code. A 1 GB VPS runs Postgres and one Node process
comfortably. Users who grow split the worker out by changing one variable.

## Compose

```
postgres    pgvector image
app         API + static UI (+ worker, in single-process mode)
worker      optional, same image, different command
```

## Hosted version

Run the same image on one small machine with managed Postgres.

Do not use a serverless platform. It cannot run an always-on worker, and the
function plus database bill passes $5 per user quickly.

Identical images for self-hosted and hosted means one set of bugs.

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
