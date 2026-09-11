# Instructions for AI coding agents

This file is the single source. `CLAUDE.md` imports it, so Claude Code and
Codex read the same rules. It is loaded into every session, so it holds only
what changes what you do next. What the project has measured is in
[docs/history.md](docs/history.md), and it is read on demand.

SignalScout finds public conversations from people describing a problem your
product solves. Read [PLAN.md](PLAN.md) for the product and
[STACK.md](STACK.md) for the stack before proposing anything structural.

---

## Where the product stands

**The pipeline works end to end and has run live**, on real providers and a
real model: a monitor goes from the form to collected posts, a pre-filter, a
classifier, an inbox of scored matches, and verdicts. It polls on a schedule,
refuses a poll that would spend past its cap, reads deep comment threads in
batches, and delivers a match by digest email, immediate email or signed
webhook.

**Six platforms are fetched, through five providers, and a connector is the
pair.** Reddit, X, LinkedIn, YouTube, TikTok and Instagram; Bright Data,
ScrapeCreators, SocialCrawl, SocialData and Apify. A platform is what a person
ticks and it keys `posts.source` and deduplication. A provider fetches, owns
the key and sends the bill. The table of who fetches what, at what price and
with what quirks, is in [docs/sources.md](docs/sources.md) — read it before
touching a connector.

**An instance has accounts, and the cloud one charges.** Better Auth in the
same Postgres, `AUTH_SIGNUP` deciding whether anybody else may register, and
every provider key, model key and provider choice scoped to an account.
`BILLING_MODE` is `off` by default, so a self-hosted instance meets none of
Stripe. Read [docs/accounts.md](docs/accounts.md) and
[docs/billing.md](docs/billing.md).

**Every default is the self-hosted answer.** `AUTH_SIGNUP=closed`,
`AUTH_EMAIL_VERIFICATION=off`, `BILLING_MODE=off`. Each was the one place an
implementation went against a literal request, and for one reason: every
instance running today is self-hosted, and a version bump that silently began
refusing logins or writes is the failure none of them would forgive. Keep that
direction when you add the next setting.

**Say what has run live and what has not.** Most of this product's claims have
a measurement behind them and a few do not. The standing gaps are real rate
limits, real provider outages, and screens no browser has rendered. When you
finish something, say which half you proved.

---

## Before you start a task

1. Find its ticket in [`backlog/OPEN.md`](backlog/OPEN.md). If there is no
   ticket, ask whether to write one first.
2. Read the ticket's **Context**. It holds the reasoning that the code cannot.
3. Read [`docs/testing.md`](docs/testing.md) if you will write a test, which is
   almost always.
4. Read [`docs/sources.md`](docs/sources.md) if the task touches a connector.
   It holds two lists — adding a provider, and adding a platform — and what
   connectors get wrong.
5. Read [`docs/costs.md`](docs/costs.md) if the task touches money — a price, a
   cap, a usage row, or a figure shown to a person. It holds what our estimate
   is wrong about, and why it is never rounded to cents.
6. Read [`docs/secrets.md`](docs/secrets.md) if the task touches a credential.
   It holds where a key lives, what the encryption guarantees, why a key is
   tested before it is stored, and the rotation steps.
7. Read [`docs/billing.md`](docs/billing.md) if the task touches the paywall,
   the trial or Stripe. It holds who is entitled, what a refused write answers,
   and why the scheduler is the half that matters.
8. Read [`docs/instruments.md`](docs/instruments.md) before running anything
   that spends money, and [`docs/history.md`](docs/history.md) when you need to
   know why a number or a decision is what it is.

The ticket's **Acceptance** list is the definition of done. Every box is true
or false. Do not mark one done that you have not verified.

---

## Rules that are easy to break

**Every address is a path, and `route.ts` holds them all.** US-076 moved the
router out of the hash on 2026-09-08, after Stripe returned a person to
`/billing?checkout=done#/billing` — one address saying the same thing twice,
because the path was the server's answer and the hash was the application's.
`apps/web/src/route.ts` is the whole table: `routes` are the patterns
`App.tsx` matches, `paths` are the builders every screen links with. Never
write an address as a string beside a link.

**A project is a path segment, not a query parameter.** `/projects/<id>`,
`/projects/<id>/monitors`, `/projects/<id>/monitors/new`. An inbox is a
question about one business, so the address is *of* that business. US-045's
rule — no project, no inbox — is the route table itself now rather than an
effect that corrects the address after rendering: an address naming no project
matches no project-scoped route and the catch-all sends it to choose one.

**The UI shares one theme.** Read [docs/design.md](docs/design.md) before changing a screen. Colors and sizing live in `apps/web/src/styles/tokens.css`; shared controls live in `styles/theme.css`. Keep page layout separate, and migrate the remaining screens one at a time.

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

**A URL we build is evidence about our own string building and none about the
platform.** It is the fixture rule again, one step later. TikTok's comment link
shipped as `?comment_id=`, which the connector invented; it survived a capture,
two live polls and a code comment admitting it was a guess, because nobody
pressed it. Open one.

**A value added to an array in `schema.ts` is not a value the database
accepts.** `modelCallPurposes`, the provider enum and their siblings are also
check constraints, and TypeScript does not know that. This has shipped three
times — `apify`, `draft_reply`, `key_test` — and each time a full suite passed,
the call succeeded, the money was spent, and recording it failed. Write the
migration in the same change.

**Scoping a route means scoping every read in it.** BUG-009 scoped the keys on
the providers page and left the spend, the counts and the verdicts answering
for the whole instance, so a new account saw somebody else's numbers. Nothing
went red, because nothing on that page was scoped by a test. Count the reads.

**One migration number, one file.** Two branches that each take the next number
merge cleanly and break at boot.

**A migration file is not a migration until `meta/_journal.json` names it.** The
migrator walks the journal and never the directory, and so does the test
harness — so a file with no entry is applied nowhere, and the whole suite passes
against a database missing the column. `pnpm db:generate` writes both halves;
BUG-012 restored it after fourteen migrations were written by hand without it.
`db/migrations.test.ts` is what fails now, by name, when the two disagree.

**This file is not a changelog, and it grew to 25,000 words by being used as
one.** A closed ticket's evidence belongs in its own **Log**, and the rule it
teaches belongs wherever the rule is read — this section, `docs/sources.md`,
`docs/costs.md`, `docs/testing.md`. Add a paragraph here only when it changes
what the next agent does, and when you do, delete the one it replaces. Every
word here is paid for in every session.

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
| A Reddit API key per user | Reddit through a provider: Bright Data, ScrapeCreators or SocialCrawl |
| X's own pay-per-use API | X through a provider: SocialCrawl, and SocialData since US-061 |
| A platform's price kept on the platform | The price on the pair: one SocialCrawl key, one credit price, and a call that costs 1 on X and 5 on LinkedIn |
| One record describing a source | A platform and a provider, separate; a connector is the pair |

**One row above was reversed on 2026-09-05.** It read: *a provider picker in the
UI* against *one provider per source, named but not chosen*. That was right
while Reddit had one usable provider and wrong the moment two fetch the same
platform, so US-024 separated the axes and the connections screen is now keyed
by provider. STACK.md, *A source is not a provider*, holds the reasoning. The
rule underneath is unchanged: the interface is not weakened to suit a provider,
and nothing downstream of a connector learns which one answered.

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

backlog/index.sh              # rebuild OPEN.md and DONE.md — run after any ticket change
backlog/index.sh --check      # exit 1 if either list is stale

pnpm --filter @signalscout/core capture:classifier   # spends money
pnpm --filter @signalscout/core capture:queries      # spends money
pnpm --filter @signalscout/core capture:embeddings   # spends money
pnpm --filter @signalscout/core capture:comment-filter # spends money
pnpm --filter @signalscout/core capture:triage        # spends money
pnpm --filter @signalscout/core live:provider-switch # spends ~$0.08
pnpm --filter @signalscout/core live:linkedin-poll   # spends ~$0.08 + model
pnpm --filter @signalscout/core live:x-poll          # spends ~$0.002 + model
pnpm --filter @signalscout/core live:apify-linkedin-poll # spends ~$0.05 + model
pnpm --filter @signalscout/core live:tiktok-poll     # spends ~$0.20 + model
pnpm --filter @signalscout/core live:tiktok-comments # spends model only
pnpm --filter @signalscout/core live:instagram-poll   # spends ~$1.65 + model
pnpm --filter @signalscout/core live:instagram-comments # spends model only
pnpm --filter @signalscout/core live:thread-loop      # spends up to a cap you pass
pnpm --filter @signalscout/core live:notification      # spends model only
pnpm --filter @signalscout/core live:webhook           # spends nothing
pnpm --filter @signalscout/core measure:lead-position # spends ~$0.40
pnpm capture:deletions                            # spends ~$0.02

node packages/core/src/sources/providers/socialcrawl/linkedin-fixtures/capture.mjs   # ~30 credits
node packages/core/src/sources/providers/socialcrawl/instagram-fixtures/capture.mjs  # 24 credits, or 14 with --lean
```

Everything from `capture:` down spends real money, and every one of them is an
instrument: it asks a real provider or a real model something and records the
answer, because an answer we wrote would be evidence about our own schema and
none about the provider. What each one asks, what it costs and when to re-run
it is in [docs/instruments.md](docs/instruments.md). Read it before running one.

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
decision that would otherwise be made twice. Do not list the changed files. The
diff already shows them.

**A ticket body has four headings and no others:** Context, Acceptance, Notes,
Log.

**A ticket date carries a time.** `created` and every Log entry use
`2026-09-05T07:31+08:00` — ISO 8601, to the minute, with the offset. Several
entries land on one day, and only the time says which came first.

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
