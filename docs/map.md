# The map

Ten minutes, for somebody who has never opened this repository. Everything
here links to the page that says it properly.

[AGENTS.md](../AGENTS.md) is the same ground written for an AI coding agent:
denser, and organised around what changes the next edit. Read this one first.

---

## What runs

Two processes and one database.

- **The API** serves the JSON routes and the built web app on one port.
  `apps/api`.
- **The worker** polls, filters, classifies and notifies. It runs inside the
  API process by default, and alone when `WORKER_IN_PROCESS=false`.
  `packages/pipeline/src/worker`.
- **Postgres**, with `pgvector` for embeddings and `pg-boss` for the queues.
  There is no Redis and no second database.

## The five folders

| | |
|---|---|
| `apps/api` | Fastify. Routes, sessions, accounts. The only half that knows a user. |
| `apps/web` | Vite and React. One file per screen in `src`, addresses in `src/route.ts`. |
| `packages/engine` | Stateless. Connectors, model calls, the cipher. Input in, result and cost out — no database, no `process.env`. |
| `packages/pipeline` | Stateful. The tables, the queues, the migrations, the worker. It imports the engine, never the reverse. |
| `packages/ui` | The brand both products wear: tokens, the shared controls, the words about a monitor. |

Three tests hold those boundaries — `engine-boundary.test.ts`,
`pipeline-boundary.test.ts`, `ui-boundary.test.ts`. If a change seems to need
one broken, the change is wrong.

## One poll, end to end

The clock is `pg-boss`. `worker/schedule.ts` decides
which monitor is due.

1. **Budget.** `worker/ceiling.ts` refuses a poll that would spend past the
   monitor's monthly cap. Nothing is asked of a provider.
2. **Collect.** `worker/collect.ts` walks each platform's connector in
   `engine/src/sources`, one request per input, keeping a cursor per platform.
   This is where the money goes, before any filter sees the text.
3. **Filter, cheaply, three times.** A keyword match
   (`engine/src/filter/keywords.ts`), then an embedding threshold
   (`engine/src/ai/embed.ts`), then a one-word question to a cheap model
   (`engine/src/ai/triage.ts`). `worker/filter.ts` runs them in that order.
4. **Classify.** `worker/classify.ts` calls the good model through
   `engine/src/ai/classify.ts` and gets relevance, problem fit, ICP fit,
   intent and urgency back.
5. **Store.** A row in `matches`, joined to the `posts` row that survived.
   `posts` is keyed by `(source, external_id)`, so the same post found twice
   is stored once.
6. **Notify.** `worker/notify.ts` sends the digest, the immediate email or
   the signed webhook.

[docs/pipeline.md](pipeline.md) has the caps, the cursors and what each step
writes.

## One request, end to end

`apps/api/src/index.ts` starts the server. `src/server.ts` registers every
route module — `matches.ts`, `monitors.ts`, `connections.ts` and the rest, one
file per subject. A route resolves the session, scopes every read it makes to
that account, and calls into `packages/pipeline` for anything stored.

**Scoping means every read in the route**, not the first one. A route that
lists scoped rows and leaves a count answering for the whole instance shows
one account another's numbers, and no test goes red unless it scopes each
read.

## Running it

```bash
pnpm install
pnpm db:up        # Postgres, which the tests need
pnpm dev          # migrations, API on 3000, Vite on 5173, worker
pnpm test         # Vitest; needs the Postgres db:up started
pnpm lint         # Biome: formatting and lint rules together
```

`pnpm test` uses a real Postgres and makes a database per test file. It does
not fall back to a fake, so it can go red without a broken test —
[docs/testing.md](testing.md) says how to tell that apart from a regression.

**No test spends money.** Nothing in the suite reaches a social API or a model
provider, and `vitest.config.ts` blanks `AI_API_KEY` so a machine with a key
exported cannot spend one by accident.

## Where the reasoning lives

The code says what it does. It does not say why, on purpose.

- **A ticket's Context** holds the reasoning behind one change.
  `backlog/OPEN.md` lists the open ones, and every one has a GitHub issue.
- **A ticket's Log** holds what it measured. When a number or a threshold
  looks arbitrary, the comment or the page beside it names the ticket, and
  that ticket's Log says what it was measured against.
  [`backlog/DONE.md`](../backlog/DONE.md) lists every finished one.
- **A page per subject** holds the rules: [sources.md](sources.md) for
  connectors, [costs.md](costs.md) for money, [secrets.md](secrets.md) for
  credentials, [testing.md](testing.md) for tests, [design.md](design.md) for
  screens.
- **[PLAN.md](../PLAN.md)** is the product and **[STACK.md](../STACK.md)** is
  why each tool beat the alternative.

Go looking when a change touches money, a credential, a connector or a
migration. Otherwise the ticket is enough.
