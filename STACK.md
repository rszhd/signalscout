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
| AI calls | Vercel AI SDK | One API over OpenAI, Anthropic, Google, DeepSeek, OpenRouter, and Ollama. |
| Schemas | Zod | AI structured output, API input, and env vars from one definition. |
| Auth | Better Auth | Sessions in our own Postgres. No external service. |
| Email | Nodemailer over SMTP | Self-hosters need SMTP. Hosted providers are just another SMTP target. |
| Secrets at rest | Node `crypto`, AES-256-GCM | User API keys are encrypted with a key from `ENCRYPTION_KEY`. Optional while keys live in `.env`; see [docs/secrets.md](docs/secrets.md). |
| Tests | Vitest, and jsdom for a screen | Real Postgres from the first file. No browser engine: nothing here runs Playwright, and a screen is driven through the DOM. |
| Lint + format | Biome | One tool, one config file. |
| Packaging | pnpm workspaces | Add Turborepo only when builds get slow. |
| Deploy | Docker Compose, one image | Postgres, API, worker. |

---

# Repository shape

```
apps/
  api/          Fastify: REST endpoints, serves the built UI and /admin
  web/          Vite + React: the intent inbox
  worker/       pg-boss: collect, filter, classify, replies, notify

packages/
  core/
    sources/    platforms.ts, and providers/<provider>/<platform>.ts
    ai/         providers, prompts, classification schema, triage
    db/         Drizzle schema and migrations
    worker/     the job steps the worker process registers
    budget/     the cap, and what a poll is allowed to spend
    billing/    entitlement and Stripe
    auth/       Better Auth, and who owns a row

admin/          Vite + shadcn/ui: the operator panel, served at /admin
landing/        Astro: the marketing site, its own lockfile, deployed alone
```

`admin/` and `landing/` are outside the application workspace. Each has its
own README.

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

The marketing site is a separate Astro static site in `landing/`, deployed
independently on Vercel. It has its own dependencies and build. It is not part
of the application workspace or Docker image. See `landing/README.md`.

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
| Reddit read, Bright Data pay-as-you-go | $0.0015 |
| Reddit read, ScrapeCreators | ~$0.00027, measured |
| X read, SocialData | $0.0002 |
| LinkedIn read, Apify | $0.002 |
| Anything through SocialCrawl | $0.008118 a credit — and a credit buys 20 X posts, 45 YouTube videos or 30 Instagram reels, where 15 Instagram comments cost five |
| Embedding pre-filter | ~$0.00001 |
| AI classification, cheap model | ~$0.001 |

The per-connector prices are in [docs/costs.md](docs/costs.md) and what each
provider bills is in [docs/sources.md](docs/sources.md). They are not repeated
here: a price copied into three documents goes stale in two of them.

Four properties of that table decide the architecture.

**The money is spent before our code ever sees the text.** Every row above is
billed at fetch time, whatever a filter later does with the post. That is what
the budget guard is built on, and it is why the cost test exists: no stage
after collection can save a person from a query that is too broad.

**A credit is not a request, and a guard fed the wrong word overspends by five
times.** One SocialCrawl credit costs the same whichever platform spends it,
and a call spends one on X and five on LinkedIn or an Instagram comment page.
So a connector reports `unitsConsumed` in the unit its own price is written
against, and a platform whose comments cost more than its posts declares
`replyPricePerUnitMicros` separately.

**A search that finds nothing is not always free.** X through SocialCrawl
refunds one and a scoped Reddit search is refunded too; LinkedIn, YouTube and
Instagram bill in full and return unrelated results rather than none. So a
vague query is not cheap noise on most platforms — it is full-price noise the
model is then paid to read.

**Where the lead is in the comments, the bill moves to the comments.** On
YouTube, TikTok and Instagram a search returns people who post to be seen and
the person worth reaching is underneath. Instagram is the extreme: one live
poll spent five times more with the provider than with the model, which is the
reverse of every other platform.

[docs/history.md](docs/history.md) holds what each platform was measured doing
— comment lengths, match rates, the noise each one produces — because that is
evidence rather than a choice about the stack.


## A source is not a provider

Reddit taught us this the hard way, so the rule is written down before it is
needed again:

> **The architecture supports replaceable providers. A platform and a provider
> are separate records, and a connector is the pair.**

**This reverses what this section said until 2026-09-05.** It read: *the product
offers one provider per source*, and it said the UI never asks a person to
choose one. That was right while Reddit had one usable provider. It is wrong now
that a person may hold a ScrapeCreators account, a Bright Data account, or both.
US-024 carried the reversal.

What separates:

* A **platform** is what a person ticks. It keys `posts.source`, it keys
  deduplication, and a monitor names it.
* A **provider** is who fetches, whose key it is, and what it bills. Price,
  billable unit, poll ceiling and credential fields all belong here.
* A **connector** is the pair, and it is what the registry holds.

A user still connects *Reddit*. The connections screen is keyed by provider,
because one SocialCrawl key serves Reddit, X, YouTube, TikTok and Instagram
together, and a screen keyed by platform would ask for it five times and rotate
it five times. Each card names the platforms that key unlocks, so the person
who set out to connect Reddit still sees Reddit.

What does not change is the rule underneath. `SocialSource` already carries
`unitsConsumed` and `next`, so a provider that bills per record and answers
asynchronously fits it without a new member. Do not weaken that interface to
accommodate a provider. If a provider does not fit, it is the provider we
describe wrongly, not the interface. And nothing downstream of a connector
learns which provider answered: replacing one changes no monitor, no score, no
match and no notification.

Two consequences are worth stating.

**A price belongs to the pair, never to the platform.** Bright Data prices a
Reddit record at $0.0015 and another provider will not price the same record the
same. A number kept on the platform would be one provider's arithmetic on every
provider's bill.

**A post is one post however many providers fetched it.** `posts.provider` is
attribution only and stays out of `UNIQUE (source, external_id)`. A key that
read it would make the same Reddit conversation two rows: a second
classification, a second embedding and a second charge.

## Reddit

**Reddit's self-serve API is closed.** Since its Responsible Builder Policy in
November 2025, registering a script or web app requires a manual approval
request. Reports from developers describe rejections for small projects and
long silences. Keys issued before the policy are grandfathered and still work.

An open-source product cannot ask every self-hoster to win an approval. So
Reddit is reached through a data provider, and the user brings that provider's
key. Three fetch it: Bright Data, ScrapeCreators and SocialCrawl.

Two facts shape every Reddit connector:

**Comments cannot be discovered by keyword.** Posts are discovered by keyword
or by subreddit. Comments are collected *by post URL only* — the same limit
Reddit's own API has. So a monitor that wants comments pays a second call per
post, and the cost per monitor roughly doubles. This is a product decision, not
a default.

**Collection may be asynchronous.** Bright Data answers a larger request with a
`snapshot_id` to poll, which is `next: { status: "wait" }` with the snapshot id
as the cursor; the scheduler does other work meanwhile. The other two answer
synchronously.

Access is not gated. Bright Data's free tier needs no card, no company
verification and no KYC review; only their proxy products are excluded, and we
use none. That was checked rather than assumed, because an unverified access
claim is what cost us Reddit.

**The terms question did not disappear by changing provider — it moved.** Bright
Data's Master Service Agreement makes the *customer* warrant that their use
violates no third-party rights, and indemnify Bright Data if it does. So
whether commercial Reddit monitoring is allowed now sits with the user, less
visibly than before. The README says so rather than implying a third party
absorbed it.

Two clauses to re-read before the hosted launch, not before a connector: a
customer may not redistribute collected data "to offer a similar or competitive
product" — bring-your-own-key keeps us clear of that, and pooling data across
users would not — and the customer is solely responsible for the lawful grounds
for personal data, where an author handle is personal data under GDPR and we
store one.

The hosted version's position is still a legal question, not an engineering
one.

## X

**X is reached through a data provider, not through X's own API.** The owner
decided this on 2026-09-05.

X's own API is the path not taken. Since February 2026 pay-per-use is its only
self-serve tier: Basic and Pro are closed to new signups, there is no free
tier, and a post read costs $0.005. That number describes X and nobody else. Do
not copy it onto a provider descriptor — `pricePerUnitMicros` comes from the
provider that will send the bill.

**The first provider was chosen by elimination and the second was chosen
against it.** US-006 asked all three accounts we already held: Bright Data's X
dataset discovers only by profile and ScrapeCreators publishes no X search at
all, so only SocialCrawl could find a stranger describing a problem. US-061
added SocialData on 2026-09-07, for half the price and for the one thing the
incumbent has no way to do: send the window to the provider instead of buying
everything older than `since` and discarding it here.

**Per-read billing makes the budget guard a prerequisite, not a follow-up.**
US-013 and US-014 landed before the X connector, which is the order this said
was needed.

## LinkedIn

**LinkedIn is fetched through Apify, and the SocialCrawl connector is switched
off.** US-057 added the Apify actor on 2026-09-07 and US-053 switched
SocialCrawl's LinkedIn connector off on 2026-09-09, on the owner's decision.
Fifty posts cost $0.2030 through SocialCrawl against $0.10 through Apify — and
the price is not what settled it. Every post Apify returned was under ninety
minutes old, where SocialCrawl orders by relevance across weeks and its twenty
stored posts reach back 543 hours. Dearest and stalest is not a trade anybody
makes.

The decision is about the **pair** and not about the platform. LinkedIn stays,
the connector is switched off rather than deleted, and its file, parser,
fixtures and tests are untouched: `ConnectorDescriptor.notOffered` carries one
sentence and nothing else changed. docs/sources.md, *Switching a connector
off*, holds the procedure and what happens to what already exists.

**Apify is a marketplace, not a data API.** What we call is one actor somebody
else publishes, so the actor can change under us without the API changing at
all. That is a reason to re-run the capture rather than to trust a fixture for
ever, and it is the one provider here where the bill settles *after* the run
ends — a run that had just returned ten posts reported five thousandths of a
cent, and its real total a few seconds later.

**The noise on LinkedIn is a different kind, and it is worse for us.** Reddit
keyword search returned posts about other subjects entirely, which a pre-filter
can drop. LinkedIn returns articles *about* the problem, written by people
building an audience — on topic, well written, and not leads. A fresher
provider did not touch it: a fresh page of thought leadership is still thought
leadership. No cheap stage can tell that from a genuine question.


# What the economics add to the build

Five rules came out of the table above. All five are built, so read them as
descriptions of why the code looks the way it does — not as a plan.

**Query precision is a cost lever.** PLAN.md says the system generates search
queries so a person avoids Boolean syntax. That is a billing feature as much as
a usability one: a loose query burns budget on posts the filter discards. The
monitor form therefore runs each query once against a small sample and says
what a month of it would cost before the monitor starts. [docs/costs.md](docs/costs.md),
*What a plan would cost, before it runs*.

**Never pay for the same post twice.** `posts` is `UNIQUE (source, external_id)`
with the provider outside the key, so the same conversation fetched through two
providers is one row. A bug that re-reads a window is not a duplicate-row
problem, it is a charge on somebody's card — which is why cursors and
deduplication are a correctness-critical surface rather than a feature.

**Budgets belong in the data model.** `api_usage` holds what each poll was
billed, per monitor, per pair, per day; the monitor holds a monthly cap and
what to do when it is reached. The guard runs before a poll, because a page is
billed when it is fetched. For a bring-your-own-keys product this is a trust
feature: nobody connects a metered key to software that cannot say what it
spent.

**The throttle is the connector's to respect.** Every provider says "slow down"
in its own dialect, and the dialect that matters is the one spoken by whoever
bills us. A connector reads that signal and backs off there, and hands the
caller `next: { status: "wait", retryAfter, cursor }` when the wait is longer
than a job should hold. `NextPage` is the whole vocabulary the caller needs,
and no caller learns how the connector found out.

**Deletions are honoured.** Content an author removed stops being shown, and
that does not soften because the data arrived through a third party. We store
an id and a short excerpt rather than a permanent copy, and a reconciliation
job re-checks matched posts. [docs/deletions.md](docs/deletions.md) holds what
each provider has and has not proved.

---

# The pre-filter

PLAN.md puts a cheap pre-filter between collection and the AI engine. It has
three stages, and the third was added once the first two were measured.

1. **Keyword and subreddit match.** Free, and inside Postgres.
2. **Embedding similarity with `pgvector`.** The monitor description is
   embedded once and each candidate post once. An embedding costs about one
   hundredth of a classification.
3. **Triage.** A cheap model is asked one question — could this author be a
   person to reach? — and answers in one word.

The third stage exists because the first two measure *subject*, and under a
post about the right subject the experts answering it are on subject too. No
similarity threshold separates a person asking from the people answering; that
was measured over two real threads, which is also why the similarity stage is
skipped for comments.

**Triage only saves money when its model is cheaper than the classifier's.** A
one-word answer is not a cheap answer — a reasoning model bills its own
thinking as output — so the whole saving is the price gap. The worker warns at
startup when the two models match. [docs/costs.md](docs/costs.md) has the
measurement.

The risk runs the other way from the cost. A stage that drops a good lead
leaves no row anybody would look at, so every drop is written to
`filter_drops`, and only an explicit refusal drops an item: a timeout, a
refusal or an unreachable provider all pass it on.

---

# Deployment

## Build in CI, not on the server

The image is built once and pulled, so build memory stops being a server
question and a self-hoster compiles nothing.

**No CI run has happened yet**, and no image is published. US-001 is the ticket
and it waits on a remote this repository does not have, so the documented
install builds locally until then.

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
function plus database bill passes the subscription quickly. The price lives in
Stripe rather than here — [docs/billing.md](docs/billing.md).

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
