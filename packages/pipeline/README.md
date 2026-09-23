# @signalscout/pipeline

**The stateful half of [SignalScout](https://github.com/rszhd/signalscout).**
Monitors, posts, matches, cursors, the budget guard and the jobs, with their
migrations. It imports [`@signalscout/engine`](https://www.npmjs.com/package/@signalscout/engine)
and re-exports it, so a consumer installs both and imports one.

```bash
npm install @signalscout/pipeline
```

Node 24 or newer. ESM only. It needs one Postgres 17 database with `pgvector`,
and nothing else — no Redis, no second store.

---

## The rule

The pipeline owns **only its own tables**. It knows an owner as a text id and
nothing more. It imports no Fastify, no React, no auth library and no payment
SDK.

So it does not know who is logged in, who may poll, or who is paying. Those are
the application's questions, and they arrive as arguments. That is what lets
one self-hosted app and one hosted app run this same code.

---

## What it does

Five queues, and the flow between them:

```
schedule-tick ──> poll ──> filter ──> classify ──> notify
                            │  ▲         │
                            ▼  │         │
                          replies <──────┘
```

- **schedule-tick** — a `pg-boss` cron, once a minute. It asks Postgres which
  monitors are due and sends their poll jobs.
- **poll** — asks each connector for what is new, stores posts, keeps the
  cursor, records what the provider billed.
- **filter** — keyword, then embedding distance in `pgvector`, then a cheap
  model's one-word triage. Every drop is written down with the number that
  caused it.
- **replies** — opens the thread under a kept post, but only when the
  platform's reply count has grown. The replies go back through the filter.
- **classify** — scores a post against the monitor and writes a match above the
  threshold.
- **notify** — email over SMTP, or a signed webhook.

Two more jobs run beside the pipeline: `reconcile`, which checks that stored
posts still exist on the platform, and `estimate`, which answers what a query
would collect and cost before anybody runs it.

**A job carries ids, never data.** That is the reason the steps are separate
queues. Retrying the classify step must not make the poll step buy the same
pages again, and a model provider being down must not cost the fetch twice.

Five attempts with backoff from 30 seconds to an hour, then one shared
`dead-letter` queue. Nothing works that queue, on purpose: a job that throws for
ever must stop, not spend a user's allowance until morning.

---

## Using it

```ts
import { runMigrations, startWorker } from "@signalscout/pipeline";
import { createLogger } from "@signalscout/engine";

await runMigrations(process.env.DATABASE_URL!);

const worker = await startWorker({
  databaseUrl: process.env.DATABASE_URL!,
  logger: createLogger({ name: "worker" }),
});

// later
await worker.stop();
```

`startWorker` creates the queues, registers the handlers, starts the cron and
returns `{ boss, db, stop }`. `pg-boss` runs its own migrations into the
`pgboss` schema of the same database, so a stuck queue is a `SELECT` in the
database you already back up.

It runs happily inside an HTTP process. Nothing here needs a container of its
own.

### Who may poll

```ts
await startWorker({
  databaseUrl,
  logger,
  entitled: async (owners) => activeSubscribers(owners),
});
```

The scheduler hands the gate every owner with a due monitor, once per tick, and
polls only for the owners it hands back. An owner the gate leaves out is never
queued and never billed. **A gate that throws enqueues nothing** — "poll
everybody while the subscriptions table is down" is the failure this argument
exists to prevent. The default, `admitEveryone`, is the self-hosted answer.

### Sending a cost test

```ts
const jobs = jobSenderFor(worker.boss);        // the worker is in this process
const jobs = await startJobSender(databaseUrl); // it is not

await jobs.sendEstimate(estimateId); // null when one is already queued
```

---

## Migrations

The SQL files ship inside this package, and the package resolves them from its
own module path. You never copy them into your repository. When you upgrade the
dependency, new files arrive with it and the next `runMigrations` applies them.

An application with tables of its own runs a second stream into the same
database, under a table name of its own:

```ts
await runMigrations(databaseUrl); // this package's, always first

await applyMigrations(databaseUrl, {
  folder: new URL("../../drizzle", import.meta.url).pathname,
  table: "__app_migrations",
});
```

Each stream keeps its own record of what ran, so neither can mistake the
other's files for its own. The pipeline keeps Drizzle's default table name,
because that is the one every older database already has.

---

## Testing

```ts
import { createTestDatabase, fastRetries, insertMonitor } from "@signalscout/pipeline/testing";
```

A separate entry point, because a helper that creates and drops databases has
no business being one autocomplete away from the code that serves requests.
There is no in-memory stand-in: the tests start at real Postgres.

---

## Versioning

`@signalscout/engine` and `@signalscout/pipeline` are published together, at
one version, from one tag. The pipeline depends on the engine at that exact
version and the two have never been tested mixed. Upgrade both, or neither.

[CHANGELOG.md](https://github.com/rszhd/signalscout/blob/main/CHANGELOG.md)
says what each version changed for a consumer.

---

## License

Fair source, under the
[Functional Source License](https://github.com/rszhd/signalscout/blob/main/LICENSE)
(FSL-1.1-ALv2). Each version becomes Apache-2.0 two years after its release.
Versions up to 0.14.0 were published under Apache-2.0 and stay under it.
