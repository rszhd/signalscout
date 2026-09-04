# Instructions for AI coding agents

This file is the single source. `CLAUDE.md` imports it, so Claude Code and
Codex read the same rules.

IntentWatch finds public conversations from people describing a problem your
product solves. Read [PLAN.md](PLAN.md) for the product and
[STACK.md](STACK.md) for the stack before proposing anything structural.

**The pipeline scores posts; nothing shows them yet.** US-001 built the
skeleton: four packages, Postgres with `pgvector`, migrations, the queue, and a
page that proves the bundle is served. US-002 added the four tables. US-003
settled the `SocialSource` interface and shipped a fake connector. US-005 added
the real Reddit connector, through Bright Data. US-007 added the scheduler, so
a monitor is polled on its own interval and the posts are stored. US-009 added
the classifier, so a post is now scored against a monitor and a match is
written when it clears the monitor's `min_score`. BUG-001 made the poll finish
what it starts: an asynchronous collection is remembered in
`source_continuations` and resumed, rather than triggered again. US-010's
server half added the query generator, the monitor writes and the routes, so a
monitor is now an HTTP call rather than an `INSERT`. US-011 added the inbox, so
a match is read back out, ordered by score and age together. Two steps are
still placeholders: US-008 owns the pre-filter, so every post reaches the
model, and US-016 owns the notification. `apps/web` now has two screens, the
monitor form and the inbox, and no screen for connections.

**Reddit's own API is closed to us.** Reddit ended self-serve app registration
in November 2025. Reddit is reached through Bright Data instead, and X through
its official pay-per-use API. Read STACK.md, *A source is not a provider*,
before touching a connector: the interface does not change to suit a provider.

**The classifier has met a real model, and the Reddit connector a real
provider.** `ai/fixtures/capture.ts` ran against a live provider on 2026-09-05,
so the prompt, the schema and the cost recording are proven for the happy path,
and the four answers it recorded are replayed in CI for nothing. The failure
paths are not proven: a real rate limit, a real refusal and a real timeout have
only been simulated. Say so until one has happened.

Two things moved after that run. US-010 changed the classifier's system prompt
— the signals now arrive as a labelled line each — so the recorded answers
predate the prompt they are replayed against. And US-010 added a second model
call, the query generator, which no model has ever answered.
`capture:classifier` and `capture:queries` are the two commands that close
those gaps. Until they run, say the recorded scores are stale and the query
generation unproven.

Two tickets are in `doing/`.
[US-001](backlog/doing/US-001-the-workspace-runs-with-one-command.md) waits on
the first CI run, which needs a remote this repository does not have.
[US-010](backlog/doing/US-010-a-monitor-is-created-from-four-answers.md) waits
on a connection-testing screen; see below.

US-007 and
[BUG-001](backlog/done/2026-09/BUG-001-a-pending-reddit-collection-is-not-resumed.md)
closed together on 2026-09-05, when one live run carried a collection from the
trigger through fifteen poll jobs to forty-nine stored posts.

[US-010](backlog/doing/US-010-a-monitor-is-created-from-four-answers.md) has
the server routes and the React form, with the jsdom harness that drives the
form through the DOM. One acceptance box stays open: credentials are present
or missing, but are not validated with the provider. The ticket's Notes keep
that open for a connection-testing screen on purpose.

**The inbox has never shown a real match.** US-011 closed on 2026-09-05
against seeded rows and stubbed responses. No match in this product has been
produced by a live classification and then read on the screen, because the
live run stored posts and never scored them with a real model. What is proven
is that the list renders what the database holds, and the ordering rule —
score, minus twelve points for every day since the post — measured at 12.7 ms
for a first page over 5,000 matches. What is not proven is that the reasons
read well to a person.

**The Reddit connector has collected once, live.** On 2026-09-05 a monitor
with one keyword triggered a collection, waited through fourteen resumes over
7.6 minutes, and stored forty-nine real posts. The trigger, the wait, the
cursor, the snapshot read and the storage are proven against the provider. A
real DNS failure hit a poll job in the same run, and the retry recovered it.

Three things are still unproven: an expired snapshot, a collection the provider
reports as failed, and a rate limit. The X connector has never run at all.

That run also measured what nobody had measured. A monitor left at the
60-second floor triggered a collection every minute, and each one billed 9 to
11 records and returned no posts, because everything it found was older than
the last poll. Poll frequency is a cost dial. US-013 and US-014 are what turn
that from a lesson into a limit.

---

## Before you start a task

1. Find its ticket in [`backlog/OPEN.md`](backlog/OPEN.md). If there is no
   ticket, ask whether to write one first.
2. Read the ticket's **Context**. It holds the reasoning that the code cannot.
3. Read [`docs/testing.md`](docs/testing.md) if you will write a test, which is
   almost always.
4. Read [`docs/sources.md`](docs/sources.md) if the task touches a connector.
   It holds the steps and the three things connectors get wrong.

The ticket's **Acceptance** list is the definition of done. Every box is true
or false. Do not mark one done that you have not verified.

---

## Rules that are easy to break

**`packages/core` imports neither Fastify nor React.** The API and the worker
both call into it. This is the one architectural rule in the repository. If a
change seems to need it, the change is wrong.

**A red test is fixed in the code, not in the assertion.** An expected value
changes only when the behaviour was meant to change, and the commit says which
and why. You write both the test and the code, so nothing else stops one
misunderstanding being encoded twice.

**No test spends money.** No test reaches the Reddit API, the X API, or a model
provider. An X read is billed at $0.005 and a test loop does not stop when the
assertion passes. `vitest.config.ts` blanks `AI_API_KEY` for the whole suite,
so a machine with a key exported cannot spend one by accident.

**Fixtures for someone else's API are captured, not written.** Never write a
Reddit or X payload from memory, however plausible. A fixture you wrote is
evidence about our parser and no evidence at all about the wire format. The
same holds for a model's answers: `ai/fixtures/*.json` came from a real
provider through `capture.ts`, and an answer you wrote would be evidence about
our schema and none about the model.

**One migration number, one file.** Two branches that each take the next number
merge cleanly and break at boot.

**The folder is the ticket's status.** Moving a ticket is `git mv`, in the same
commit as the code that caused it, followed by `backlog/index.sh`. There is no
`status:` field. Never add one.

---

## Decisions that are settled

Do not reopen these without being asked. The reasoning is in
[STACK.md](STACK.md) under *Why these choices*.

| Not this | This |
|---|---|
| Next.js | Vite static build + Fastify |
| Redis, BullMQ | `pg-boss` inside Postgres |
| A separate vector database | `pgvector` |
| Prisma | Drizzle |
| Python | TypeScript |
| A managed auth service | Better Auth in our own Postgres |
| An in-memory Postgres fake | Real Postgres, from the first test file |
| A Reddit API key per user | Reddit through Bright Data |
| A provider picker in the UI | One provider per source, named but not chosen |

If you believe one is wrong, say so in one paragraph and wait. Do not
reintroduce it as part of another change.

---

## Correctness-critical surfaces

These are written test-first: the assertion is written and reviewed before the
implementation. Each file carries a `Correctness-critical` header comment
naming its failure shape.

- **Budget guard** — money spent past a cap, silently, at 02:00
- **Cursor and deduplication** — the same post fetched and billed twice
- **Credential encryption** — a key reaching a log line or an API response
- **Classification schema** — an invalid score stored as if it were a verdict
- **Deletion reconciliation** — removed content still being shown

A rule is only as tested as its least-tested caller. After asserting the rule,
count the call sites and give each its own case.

---

## Commands

```bash
pnpm dev                      # Postgres, migrations, API (3000), Vite (5173), worker
pnpm test                     # Vitest; needs the Postgres that `pnpm db:up` starts
pnpm lint                     # Biome: formatting and lint rules together
pnpm typecheck                # tsc --build across the workspace, plus the web app
pnpm build                    # every package, then the Vite bundle
pnpm db:up                    # Postgres alone, for `pnpm test`
pnpm db:migrate               # apply migrations to DATABASE_URL, read from .env
pnpm db:generate              # drizzle-kit generate, after a schema change

docker compose up             # the published image: Postgres, migrations, the app

backlog/index.sh              # rebuild OPEN.md and DONE.md — run after any ticket change
backlog/index.sh --check      # exit 1 if either list is stale

pnpm --filter @intentwatch/core capture:classifier   # spends money; see below
pnpm --filter @intentwatch/core capture:queries      # spends money; see below
```

These two are the only commands here that spend money, and both are
instruments: they ask a real model something and record what it said, because
an answer we wrote would be evidence about our own schema and none about the
model.

`capture:classifier` scores PLAN.md's four worked examples, records the answers
as the fixtures `ai/examples.test.ts` replays, and prints the scores that
justify the default `min_score`. Four short calls.

`capture:queries` writes the search queries for the same example monitor and
records them. One short call. Read its output rather than trusting it: two
failures are invisible to the schema, a subreddit that does not exist and eight
queries that are one query written eight ways.

Re-run either when its prompt, its schema or the model changes, and put the
numbers in the ticket.

Do not invent a command that does not exist yet — check `package.json` first.

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake.

---

## Writing

**Repository documents keep the project's voice.** Short sentences, active
voice, one idea per sentence. No idioms, no metaphors. Say "the tests pass",
not "green".

**Commit messages stay under 300 words.** Subject as a prose sentence, then a
body holding only what the diff cannot say — the why, the constraint, the
decision that would otherwise be made twice. Do not list the changed files. The
diff already shows them.

**A ticket body has four headings and no others:** Context, Acceptance, Notes,
Log.

---

## What to do when you are unsure

Say so, in one or two sentences, and continue with everything the uncertainty
does not block. State the assumption you made.

Do not: silently narrow the scope, add a dependency to avoid a hard problem,
mark an acceptance box done because it is probably fine, or produce a summary
that reports work you did not verify.

If a change's reason for existing rests on third-party behaviour — a rate limit
header, a provider's payload shape, an OAuth refresh — the suite covers our half
only. Say that the claim is unproven until it runs somewhere real.
