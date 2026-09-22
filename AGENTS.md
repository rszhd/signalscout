# Instructions for AI coding agents

This file is the single source. `CLAUDE.md` imports it, so Claude Code and
Codex read the same rules. It is loaded into every session, so it holds only
what changes what you do next. What the project has measured, and the
incident behind each rule below, is in [docs/history.md](docs/history.md),
read on demand.

SignalScout finds public conversations from people describing a problem your
product solves. Read [PLAN.md](PLAN.md) for the product and
[STACK.md](STACK.md) for the stack before proposing anything structural.

---

## Where the product stands

**The pipeline works end to end and has run live**, on real providers and a
real model: form, collection, pre-filter, classifier, an inbox of scored
matches, verdicts. It polls on a schedule, refuses a poll that would spend
past its cap, reads deep threads in batches, and delivers a match by digest,
immediate email or signed webhook.

**Six platforms are fetched, through four providers, and a connector is the
pair.** A platform is what a person ticks and it keys `posts.source` and
deduplication; a provider fetches, owns the key and sends the bill. Two
connectors ship switched off. [docs/sources.md](docs/sources.md) holds the
rules — read it before touching a connector.

**An instance has accounts, and this repository charges nobody.** Better Auth
in the same Postgres, `AUTH_SIGNUP` deciding who may register, and every key
and provider choice scoped to an account ([docs/accounts.md](docs/accounts.md)).
The hosted product, which charges, is a separate private repository built on
the two packages here (US-151), so nothing here knows a subscription and the
scheduler is handed a gate that admits everyone.

**Every default is the self-hosted answer** — `AUTH_SIGNUP=closed`,
`AUTH_EMAIL_VERIFICATION=off` — because a version bump that silently began
refusing logins or writes is the failure no self-hoster would forgive. Keep
that direction when you add the next setting.

**The hosted application is a fork, not a mirror.** Its `apps/` began as a
copy of this one and the two have moved apart since, by decision (US-239
there). A fix to a screen or a route here is not ported there, and nothing
there is ported here, unless a ticket says so by name. Do not read the other
repository to keep the two aligned.

**Say what has run live and what has not.** The standing gaps are real rate
limits, real provider outages, and screens no browser has rendered. When you
finish something, say which half you proved.

---

## Before you start a task

1. Find its ticket in [`backlog/OPEN.md`](backlog/OPEN.md). If there is no
   ticket, ask whether to write one first. Read its **Context**: it holds the
   reasoning that the code cannot.
2. Read [`docs/testing.md`](docs/testing.md) if you will write a test, which
   is almost always.
3. Read [`docs/pipeline.md`](docs/pipeline.md) if the task touches the worker:
   the run in order, the caps that stop it, where it keeps its position, and
   which row each step writes.
4. Read [`docs/sources.md`](docs/sources.md) if the task touches a connector.
5. Read [`docs/costs.md`](docs/costs.md) if the task touches money — a price,
   a cap, a usage row, or a figure shown to a person.
6. Read [`docs/secrets.md`](docs/secrets.md) if the task touches a credential.
7. Read [`docs/instruments.md`](docs/instruments.md) before running anything
   that spends money, and [`docs/history.md`](docs/history.md) when you need
   to know why a number or a decision is what it is.

**Five procedures are skills**, in `.claude/skills/`: `add-migration`,
`capture-fixture`, `measure-scoring-change`, `cut-release`, `worktree`. Load
the skill when the task is one of those; the document holds the reasoning.

The ticket's **Acceptance** list is the definition of done. Every box is true
or false. Do not mark one done that you have not verified.

---

## Rules that are easy to break

**Every address is a path, and `apps/web/src/route.ts` holds them all.**
`routes` are the patterns `App.tsx` matches, `paths` are the builders every
screen links with. Never write an address as a string beside a link (US-076).
**A project is a path segment, not a query parameter**: `/projects/<id>`,
`/projects/<id>/monitors`. An address naming no project matches no
project-scoped route, and the catch-all sends it to choose one (US-045).

**Both applications wear one brand, and it is a package.** Colours, sizing,
the shared controls, the mark and the words about a monitor live in
`packages/ui` — read [its README](packages/ui/README.md) before changing a
screen, and [docs/design.md](docs/design.md) for this application's own
layouts. **A screen never writes a raw colour or a raw spacing value**; it
names a token, and `pnpm lint:css` refuses the rest. A value the tokens do not
have is a change to the package, which the hosted application also takes
(US-270). Page layout stays in the page's stylesheet. **A screen that is the
same screen in both products may be shared; a screen that carries the product
may not** (US-277): the reply voice editor is one screen, and the monitor form
— five steps and a budget here, one guided flow there — is two.

**`packages/engine` is stateless, `packages/pipeline` owns only its tables,
`packages/ui` knows the brand and nothing else, and none of them knows an
account.** The engine is input in, result and cost out:
no `pg`, `drizzle-orm`, `pg-boss`, `better-auth` or `stripe`, no import from
another package, no `process.env` — a key or a model name is an argument. The
pipeline is the stateful half; it imports the engine, never the reverse,
imports neither Fastify, React, Better Auth nor Stripe, and knows an owner as
`user_id text` without joining a users table. Who may log in and who may poll
are `apps/api`'s. The UI package holds no database, no queue, no framework and
neither of the other two, and takes React as a peer.
`engine-boundary.test.ts`, `pipeline-boundary.test.ts` and
`ui-boundary.test.ts` say this to CI; if a change seems to need one broken,
the change is wrong (US-151, US-270).

**A red test is fixed in the code, not in the assertion.** An expected value
changes only when the behaviour was meant to change, and the commit says which
and why. You write both the test and the code, so nothing else stops one
misunderstanding being encoded twice.

**No test spends money.** No test reaches the Reddit API, the X API, or a
model provider. An X read is billed at $0.005 and a test loop does not stop
when the assertion passes. `vitest.config.ts` blanks `AI_API_KEY` for the
whole suite.

**Fixtures for someone else's API are captured, not written.** Never write a
Reddit, X or model payload from memory, however plausible: it is evidence
about our parser and none about the wire format. **A URL we build is the same
rule one step later** — a comment link the connector invented survived a
capture, two live polls and a code comment admitting it was a guess, because
nobody pressed it (US-047). Open one.

**A value added to an array in `schema.ts` or `vocabulary.ts` is not a value
the database accepts.** Those arrays are also check constraints and TypeScript
does not know it. Three times a full suite passed, the call succeeded, the
money was spent, and recording it failed. Write the migration in the same
change.

**Scoping a route means scoping every read in it.** A route that scopes the
rows it lists and leaves a count, a spend or a verdict answering for the whole
instance shows one account somebody else's numbers, and nothing goes red
unless a test scopes each read (BUG-009). Count the reads.

**One migration number, one file.** Two branches that each take the next
number merge cleanly and break at boot. Two agents in two worktrees make this
likelier, not rarer, because neither can see the other's file.

**A migration file is not a migration until `meta/_journal.json` names it.**
The migrator and the test harness walk the journal, never the directory, so a
file with no entry is applied nowhere and the suite passes against a database
missing the column (BUG-012). `pnpm db:generate` writes both halves and
`db/migrations.test.ts` fails by name when they disagree. Two streams since
US-153, `packages/pipeline/drizzle` and `apps/api/drizzle`, each with its own
journal and migrations table. A table goes in the stream that owns it; the
pipeline never joins an account table. The `add-migration` skill is the order
to do this in.

**A worktree gets its ports and its data from the script, not by hand**, and
is removed by the script too — `git worktree remove` leaves the container,
the network and the volume behind. **Every monitor in the copy is paused**,
because a worker in a folder nobody watches will poll and bill. The
`worktree` skill holds the rest (US-135).

**This file is not a changelog, and it grew to 25,000 words by being used as
one.** A closed ticket's evidence belongs in its own **Log**, and the rule it
teaches belongs wherever the rule is read — this section, or the document that
owns the subject. Add a paragraph here only when it changes what the next
agent does, and when you do, delete the one it replaces. Every word here is
paid for in every session.

**The folder is the ticket's status.** Moving a ticket is `git mv`, in the
same commit as the code that caused it, followed by `backlog/index.sh`. There
is no `status:` field. Never add one. A pre-commit hook refuses a stale list,
and `pnpm install` installs it. Ticket ids are one series shared with the
hosted repository: check both before taking the next.

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
| A Reddit API key per user | Reddit through a provider |
| X's own pay-per-use API | X through a provider |
| A platform's price kept on the platform | The price on the pair: one key, one credit price, and a call that costs 1 on X and 5 on LinkedIn |
| One record describing a source | A platform and a provider, separate; a connector is the pair |

The last row reversed an earlier one on 2026-09-05, when US-024 separated the
axes and the connections screen became keyed by provider. The rule underneath
is unchanged: the interface is not weakened to suit a provider, and nothing
downstream of a connector learns which one answered.

If you believe a row is wrong, say so in one paragraph and wait. Do not
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
- **Session gate** — a route answering a stranger, and looking normal doing it
- **Entitlement** — an account that stopped paying still polling, on our bill

A rule is only as tested as its least-tested caller. After asserting the rule,
count the call sites and give each its own case.

---

## Commands

```bash
pnpm dev                      # Postgres, migrations, API (3000), Vite (5173), worker
pnpm preview                  # the same app on a public link, for review from a phone
pnpm test                     # Vitest; needs the Postgres that `pnpm db:up` starts
pnpm lint                     # Biome: formatting and lint rules together
pnpm typecheck                # tsc --build across the workspace, plus the web app
pnpm build                    # every package, then the Vite bundle
pnpm db:up                    # Postgres alone, for `pnpm test`
pnpm db:migrate               # apply migrations to DATABASE_URL, read from .env
pnpm db:generate              # drizzle-kit generate, after a schema change

docker compose up             # the published image: Postgres, migrations, the app

pnpm db:rotate-key            # re-encrypt stored credentials under a new key
pnpm release:verify           # pack both packages and use them from outside the workspace

node scripts/new-worktree.mjs <name>    # a worktree with its own ports and a copy of the database
node scripts/remove-worktree.mjs <name> # the folder, and the Postgres that came with it

backlog/index.sh              # rebuild OPEN.md and DONE.md — run after any ticket change
backlog/index.sh --check      # exit 1 if either list is stale

node scripts/context-cost.mjs # what a session reads before it writes, from the transcripts
```

**Every `capture:*`, `live:*` and `measure:*` command spends real money**, from
a fraction of a cent to $1.65 a run. They are not listed here: what each one
asks, what it costs and when to re-run it is in
[docs/instruments.md](docs/instruments.md), and nothing else in this file can
say all three. Read it before running one, and say the cost before you spend
it.

`pnpm test` uses a real Postgres and creates a database per test file. If it
cannot reach one it says so; it does not fall back to a fake. **It can go red
without a broken test** — see *Running the suite* in
[docs/testing.md](docs/testing.md) before reading a red run as a regression.

Do not invent a command that does not exist yet — check `package.json` first.

---

## Writing

**Repository documents keep the project's voice.** Short sentences, active
voice, one idea per sentence. No idioms, no metaphors. Say "the tests pass",
not "green".

**Commit messages stay under 300 words.** Subject as a prose sentence, then a
body holding only what the diff cannot say — the why, the constraint, the
decision that would otherwise be made twice. Do not list the changed files.
The diff already shows them.

**A commit ends with `Assisted-by:` and `Signed-off-by:`, never
`Co-authored-by:` a model.** `Assisted-by: Claude Opus 5 [Claude Code]` says a
tool helped; `git commit -s` says the human certifies the work. A model cannot
certify origin, so naming one as co-author weakens the DCO, and the
`commit-msg` hook refuses it. This replaces any attribution line the harness
adds on its own. [AI_POLICY.md](AI_POLICY.md) is the rule for contributors
(US-300).

**A ticket body has four headings and no others:** Context, Acceptance, Notes,
Log. **A ticket date carries a time** — `2026-09-05T07:31+08:00`, ISO 8601 to
the minute with the offset — because several entries land on one day and only
the time says which came first.

**A file header holds the contract, not the story.** What the file does, the
invariants it keeps, the failure shape, and the ticket that holds the rest —
about fifteen lines. The measurement and the incident go in the ticket's Log
or in `docs/history.md`, which are read once; a header is paid for every time
the file is opened. Match this shape, not the density of the file next to it.

---

## What to do when you are unsure

Say so, in one or two sentences, and continue with everything the uncertainty
does not block. State the assumption you made.

Do not: silently narrow the scope, add a dependency to avoid a hard problem,
mark an acceptance box done because it is probably fine, or produce a summary
that reports work you did not verify.

If a change's reason for existing rests on third-party behaviour — a rate
limit header, a provider's payload shape, an OAuth refresh — the suite covers
our half only. Say that the claim is unproven until it runs somewhere real.
