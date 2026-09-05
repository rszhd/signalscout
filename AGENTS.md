# Instructions for AI coding agents

This file is the single source. `CLAUDE.md` imports it, so Claude Code and
Codex read the same rules.

IntentWatch finds public conversations from people describing a problem your
product solves. Read [PLAN.md](PLAN.md) for the product and
[STACK.md](STACK.md) for the stack before proposing anything structural.

**The pipeline works end to end, and US-022 ran it.** On 2026-09-05 one
monitor went from the form to fifty collected posts, twenty scored matches and
five verdicts, all live. US-001 built the
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
a match is read back out, ordered by score and age together. US-013 added the
budget guard, so a poll is refused before it spends past a monitor's monthly
cap, and every billed page is written to `api_usage` as it comes back. US-014
added the cost test, so the monitor form runs each query once against a small
sample and says what a month of it would cost before the monitor starts.
BUG-002, found by that test's first live run, stopped a seven-day window being
bought as a month. US-008 added the pre-filter, so a post now has to match a
word or a subreddit, and then clear a similarity threshold, before the model is
paid to read it — and its embedding calls closed US-013's last box, so the
spend a cap counts is now every kind of call. US-012 added the feedback loop's
first half, so a match is marked good or not relevant, the verdict is kept as
history against the version of the monitor it judged, and a dismissed match
leaves the inbox without leaving the database. US-022 then ran the whole path against real
providers, and fixed the bug it found: a `PATCH` that carried one setting
erased every field it did not carry, because the body schema filled the absent
keys with its own defaults. One step is still a placeholder: US-016 owns the
notification. US-004 added the encrypted credential store, so
a key can live in the database rather than in `.env`, and US-023 added the
screen that writes one: a key is tested with the provider before it is stored,
and a key the provider refuses is never stored. That closed US-010's last box. `apps/web` has four
screens: the monitor form, the inbox, the monitor list and connections.

**A real credential has been stored, tested and read back.** On 2026-09-05
US-023 built the connections screen and ran it against Bright Data. A wrong key
was refused in 1.3 seconds, a `PUT` carrying it wrote no row, and the real key
was accepted in 1.4 seconds and stored encrypted — hint `••••b3e7`, ciphertext
93 characters, and no row anywhere containing the plaintext. Then the process
was restarted with `REDDIT_API_KEY` unset, so the database held the only copy,
and a test with an empty body decrypted the stored value and Bright Data
accepted it. Paste, test, encrypt, store, boot-check, decrypt, provider
accepts: proven end to end, on one source.

Five probes billed nothing. `api_usage` recorded no row for any of them, which
is the free-check claim measured rather than argued.

Two things stay unproven. The X connector has never run, so its probe is
unmeasured. And no real browser has rendered the screen — it is driven through
jsdom only.

One consequence bites on any machine that has stored a credential: the process
refuses to boot without `ENCRYPTION_KEY`. That is US-004's check working as
documented, and it means a process started before the key existed must be
restarted.

**A key is tested where it is pasted, not where it is used.** The connections
screen calls `SocialSource.validateCredentials` before it stores anything. On
Reddit the probe is free: an empty input list cannot start a collection, so a
bad key is refused at 401 before the input is read. A refusal and an unreachable
provider are different answers — 200 with `valid: false` and the provider's own
sentence, against 502 — because they lead to different actions. Read
docs/secrets.md, *Testing before storing*.

**Reddit's own API is closed to us.** Reddit ended self-serve app registration
in November 2025. Reddit is reached through Bright Data instead, and X through
its official pay-per-use API. Read STACK.md, *A source is not a provider*,
before touching a connector: the interface does not change to suit a provider.

**The embedder has met a real provider once.** On 2026-09-05
`capture:embeddings` embedded PLAN.md's example monitor and the five fake posts
with OpenAI's `text-embedding-3-small`, for 176 tokens. The provider path, the
key fallback, the 1,536-number width and the cost recording are proven for the
happy path. The failure paths are not: a real rate limit, a real timeout and a
real refusal have only been simulated.

That run also measured the threshold. The four on-topic posts scored 0.26 to
0.57 and the sourdough post 0.09, so the default of 0.15 sits inside a gap of
0.18, and `ai/similarity.test.ts` replays those numbers and goes red if it
leaves. **That is one monitor and five posts, not a distribution.** The
`filter_drops` rows are the instrument that moves it next.

One thing follows for a deployment: Anthropic — our default model provider —
publishes no embedding endpoint, so the common install runs the free keyword
stage and sends everything it keeps to the model until `AI_EMBEDDING_PROVIDER`
names something else. On OpenAI it needs nothing: the embedding provider, model
and key all fall back to the ones the classifier uses.

**The classifier has met a real model, and its fixtures are current.**
`capture:classifier` ran on 2026-09-05 against the system prompt US-010
shipped, and recorded 7, 64, 86 and 96 for PLAN.md's four worked examples,
whose intents are 3, 50, 90 and 96. The order holds and the gap between the
drop and the first match is 57 points. `ai/examples.test.ts` replays those
answers. The failure paths are still not proven: a real rate limit, a real
refusal and a real timeout have only been simulated. Say so until one has
happened.

**The query generator has answered once.** `capture:queries` ran on the same
day and `ai/fixtures/query-plan.json` holds the plan it wrote — seven queries
and five subreddits for the example monitor. The seven are seven angles and
not one query written seven ways. All five subreddit names exist: four were opened by
hand, because Reddit answers 403 to an unauthenticated request, and
`softwaretesting` was proven by a collection that returned fifty posts from
it. What the plan is not proven to be is *useful* — a name that exists can
still be the wrong place to look.

One ticket is in `doing/`.
[US-001](backlog/doing/US-001-the-workspace-runs-with-one-command.md) waits on
the first CI run, which needs a remote this repository does not have.

US-007 and
[BUG-001](backlog/done/2026-09/BUG-001-a-pending-reddit-collection-is-not-resumed.md)
closed together on 2026-09-05, when one live run carried a collection from the
trigger through fifteen poll jobs to forty-nine stored posts.

US-010 closed with US-023. It has the server routes, the React form and the
jsdom harness that drives the form through the DOM. Its last box — a monitor
with no *valid* credential cannot start — is met by the connections screen and
not by the form: the form still asks only whether a key exists, because a
resume that called a provider would be refused by an outage that has nothing to
do with the key.

**The inbox has shown real matches.** On 2026-09-05 US-022 carried one
monitor from the form to twenty matches, scored by a live model and read on the
screen. The top one scored 71: a QA lead joining a company with no automation,
who asks what to prioritise from day one. The reasons are specific to the post
and a person can act on them. US-011's other measurement stands: the ordering
rule — score, minus twelve points for every day since the post — at 12.7 ms for
a first page over 5,000 matches.

**Five verdicts have been given on real matches.** On 2026-09-05 a person
read five of US-022's matches and answered: good at 71 and 59, not relevant at
53, 52 and 50, every one against version 1. The verdicts do not follow the
scores. The three refused posts ask how to learn test automation, which is a
career question and not a buyer, and the classifier scored them like the two
that were kept. **Five verdicts on one monitor is not a distribution**, and the
score is not yet shown to be wrong — it is shown to be untested. The verdicts
are still collected and not used: feeding them back into the classifier is a
separate ticket that is not written, because a learning loop with nothing to
learn from is speculation.

One rule from that ticket is easy to get wrong later. `monitors.version` counts
edits to the four fields `ai/prompt.ts` puts in the system prompt — the
product, the ideal customer, the problem and the signals — and nothing else. It
is the version a verdict was given against. A rename, an edited query or a
moved threshold must not move it.

**The Reddit connector has collected twice, live, and both discovery modes
are proven.** On 2026-09-05 a monitor with one keyword triggered a collection,
waited through fourteen resumes over 7.6 minutes, and stored forty-nine real
posts. A real DNS failure hit a poll job in that run, and the retry recovered
it. Later the same day US-022 collected one subreddit: fifty records for
$0.075, with the snapshot ready after 8 minutes 40 seconds. The trigger, the
wait, the cursor, the snapshot read and the storage are proven for the keyword
phase and the subreddit phase alike.

Three things are still unproven: an expired snapshot, a collection the provider
reports as failed, and a rate limit. The X connector has never run at all.

That run also measured what nobody had measured. A monitor left at the
60-second floor triggered a collection every minute, and each one billed 9 to
11 records and returned no posts, because everything it found was older than
the last poll. Poll frequency is a cost dial. US-013 turned half of that lesson
into a limit; US-014 turned the other half into arithmetic — polls a month is
the multiplier, so the same query costs $10.80 a month polled hourly and $648
polled every minute.

**Keyword discovery returns noise. A subreddit does not.** On 2026-09-05
US-022 collected the same monitor both ways, for the same $0.075. The model's
own keyword, "end to end tests keep breaking", brought back "failed both exams
and don't know what to do" from r/AllFinraExams and "A never ending test" from
r/islam: Bright Data matched "test" and "end" as ordinary words. One subreddit,
r/softwaretesting, brought back fifty posts that are all on topic. The
forty-nine posts the earlier keyword run stored are the same noise, and so are
the four matches they produced.

Two numbers came with that. A `min_score` of 30 is too low for a subreddit:
"Dev memes" scored 33 and reached the inbox, because inside a topical subreddit
every post is somewhat relevant and the scores compress upward. At 50 the same
poll leaves nine matches and all nine are real. And the pre-filter dropped one
post of fifty, because it was built for keyword noise — with subreddit
discovery every collected post costs a model call, and that belongs in any
arithmetic shown to a person.

**The budget guard has never refused a real poll.** It has now allowed one
and counted it: US-022's poll ran under a $0.20 cap and recorded $0.075 against
it. Refusing is the half that no live run has reached. US-013's arithmetic, its
cap and its two exhausted behaviours are asserted against real Postgres and a
fake connector, and six deliberate mutations were confirmed to turn the suite
red. What no test can prove is the input: the guard multiplies the units a
connector reports by the price the connector declares. One day has now been
compared against the provider's dashboard: on 2026-09-05 Bright Data reported
95 records and $0.14, and `api_usage` held 98 records and $0.147 — 3.2% high,
not low. That is one day against a dashboard, not a reconciliation against an
invoice. Say the spend is an estimate, because
[docs/costs.md](docs/costs.md) says so to the user in four specific ways.

**An embedding has no price until somebody sets one.** `provider.ts` carries
chat prices read from a provider's page; we have read no embedding price, so an
embedding call is recorded with a null cost until `AI_EMBEDDING_PRICE_MICROS`
is set. Null means "we cannot say", which is the same rule an unpriced chat
model already follows. Do not fill that table from memory.

**A cap can be overshot by one poll.** The guard runs before a poll, because a
page is billed when it is fetched. It cannot know what that poll will cost, so
a monitor at $9.99 of a $10.00 cap starts one more poll. `maxPagesPerPoll`
bounds the overshoot. US-014 does not remove it and was never going to: what
the cost test changes is that a person is shown the size of the thing before
they start it.

**The cost test has run three times, and the first run corrected it.** On
2026-09-05 three samples were collected live for $0.042. The trigger, the wait, the cursor, the
resume and the unattributed `api_usage` row all worked. The arithmetic did not:
it projected from the posts a sample kept, and the provider bills the records
it collects. A query that had just cost ten records was reported as free.

It now projects from `unitsConsumed`, and reports a range whenever a sample was
billed everything it asked for, because one sample of ten cannot say what a
poll of fifty costs. **Cost comes from units and volume comes from posts. Never
price anything from a post count** — that is the mistake, it cost $0.042 to
find, and the interface has carried `unitsConsumed` for exactly this reason
since US-003.

A second run, after BUG-002 was fixed, verified the window: the same keyword
kept all ten posts inside seven days, where it had kept none. What is still
unproven is that a keyword sample of ten predicts a keyword poll of fifty. The
range is an admission of that, not a measurement of it.

A third run, in US-022, billed ten records for $0.015 and projected $10.80 to
$54.00 a month for one keyword polled hourly, which is over a $0.20 cap, so the
form offered to save the plan without starting it. **The three live tests took
1 minute 41 seconds, 8 minutes 8 seconds and 2 minutes 45 seconds**, so the
screen's "about two minutes" is the fastest case and not the normal one.

---

## Before you start a task

1. Find its ticket in [`backlog/OPEN.md`](backlog/OPEN.md). If there is no
   ticket, ask whether to write one first.
2. Read the ticket's **Context**. It holds the reasoning that the code cannot.
3. Read [`docs/testing.md`](docs/testing.md) if you will write a test, which is
   almost always.
4. Read [`docs/sources.md`](docs/sources.md) if the task touches a connector.
   It holds the steps and the three things connectors get wrong.
5. Read [`docs/costs.md`](docs/costs.md) if the task touches money — a price, a
   cap, a usage row, or a figure shown to a person. It holds what our estimate
   is wrong about, and why it is never rounded to cents.
6. Read [`docs/secrets.md`](docs/secrets.md) if the task touches a credential.
   It holds where a key lives, what the encryption guarantees, why a key is
   tested before it is stored, and the rotation steps.

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

pnpm db:rotate-key            # re-encrypt stored credentials under a new key

backlog/index.sh              # rebuild OPEN.md and DONE.md — run after any ticket change
backlog/index.sh --check      # exit 1 if either list is stale

pnpm --filter @intentwatch/core capture:classifier   # spends money; see below
pnpm --filter @intentwatch/core capture:queries      # spends money; see below
pnpm --filter @intentwatch/core capture:embeddings   # spends money; see below
```

These three are the only commands here that spend money, and all three are
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

`capture:embeddings` measures how near each of PLAN.md's five posts is to the
example monitor, and records the similarities — not the vectors, which would be
a quarter of a megabyte to re-prove arithmetic `pgvector` already does.
`ai/similarity.test.ts` replays them and fails if the default threshold leaves
the measured gap. Two short calls, well under a hundredth of a cent. It needs
an embedding provider: Anthropic has none.

Re-run any of them when its prompt, its schema or the model changes, and put
the numbers in the ticket.

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
