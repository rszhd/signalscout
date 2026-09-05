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
keys with its own defaults. US-016 added SMTP digests, optional immediate email alerts and signed
webhooks. Delivery state survives restarts in Postgres. Nodemailer has sent
through a local TLS SMTP receiver; Resend inbox delivery and a third-party
webhook receiver remain unproven. Read docs/notifications.md for setup. US-004 added the encrypted credential store, so
a key can live in the database rather than in `.env`, and US-023 added the
screen that writes one: a key is tested with the provider before it is stored,
and a key the provider refuses is never stored. That closed US-010's last box. `apps/web` has four
screens: the monitor form, the inbox, the monitor list and connections.

**A real credential has been stored, tested and read back.** On 2026-09-05
US-023 built the connections screen and ran it against Bright Data. US-024 then
re-keyed that row from `reddit` to `brightdata`, and rehearsed the migration
against a real database: a key stored the old way came back readable through
the new code, with nobody retyping it. A wrong key
was refused in 1.3 seconds, a `PUT` carrying it wrote no row, and the real key
was accepted in 1.4 seconds and stored encrypted — hint `••••b3e7`, ciphertext
93 characters, and no row anywhere containing the plaintext. Then the process
was restarted with `REDDIT_API_KEY` unset, so the database held the only copy,
and a test with an empty body decrypted the stored value and Bright Data
accepted it. Paste, test, encrypt, store, boot-check, decrypt, provider
accepts: proven end to end, on one source.

Five probes billed nothing. `api_usage` recorded no row for any of them, which
is the free-check claim measured rather than argued.

Two things stay unproven. No X poll has run through the worker and stored a
post — the connector has met the provider, but only through its capture script.
And no real browser has rendered the screen — it is driven through jsdom only.

One consequence bites on any machine that has stored a credential: the process
refuses to boot without `ENCRYPTION_KEY`. That is US-004's check working as
documented, and it means a process started before the key existed must be
restarted.

**A key is tested where it is pasted, not where it is used.** The connections
screen calls `SocialSource.validateCredentials` before it stores anything. The
screen is keyed by provider since US-024, so one card is one account and one
rotation. On
Reddit the probe is free: an empty input list cannot start a collection, so a
bad key is refused at 401 before the input is read. A refusal and an unreachable
provider are different answers — 200 with `valid: false` and the provider's own
sentence, against 502 — because they lead to different actions. Read
docs/secrets.md, *Testing before storing*.

**Neither platform is reached through its own API.** Reddit ended self-serve
app registration in November 2025. X's own API is pay-per-use with no free
tier, and on 2026-09-05 the owner decided not to use it. Both platforms are
reached through data providers. Reddit runs through Bright Data and
ScrapeCreators; **X runs through SocialCrawl**, which US-006 added because
neither of the other two can search X — Bright Data's X dataset discovers only
by profile, and ScrapeCreators has no X search endpoint at all. $0.005 per read
is X's own price and it travels to nobody else. Read STACK.md, *A source is not
a provider*, before touching a connector: the interface does not change to suit
a provider.

**A platform and a provider are separate things.** US-024 split them on
2026-09-05, because two providers will fetch Reddit and they agree about
neither the price nor the key. A *platform* is what a person ticks — it keys
`posts.source` and deduplication, and a monitor names it. A *provider* is who
fetches, whose key it is, and what it bills. A *connector* is the pair, and it
is what the registry holds. Six columns carry the provider beside the platform:
`api_usage`, `source_continuations`, `posts` (attribution only, and outside the
deduplication key), `source_credentials` (keyed by provider alone),
`query_estimate_probes` (a sample holds a cursor, so it belongs to the provider
that took it, and its price comes from the pair) and `source_providers`
(US-026's store of who fetches what). An environment variable is named after
the provider — `BRIGHTDATA_API_KEY`, with `REDDIT_API_KEY` read as a deprecated
fallback — and the connections screen is keyed by provider too, because one key
serves every platform behind it.

The split changed no behaviour, and the suite is the evidence: no expected value
moved except the ones the ticket asked to move. What it did not do is run live.

**Reddit has two providers, and one live poll has run through each.** US-025
added ScrapeCreators on 2026-09-05. It is a different shape from Bright Data in
every way except the interface: the API is synchronous, so a search returns its
posts in 1.8 to 4.9 seconds and the connector never waits on a snapshot; it
bills a *request* rather than a record, and reports `credits_charged` on every
answer, so `unitsConsumed` is measured and not assumed. A subreddit page cost
$0.075 through Bright Data and $0.00376 through ScrapeCreators.

Three of its facts were not in the provider's documentation, and the capture
script found all three: a `timeframe` is refused beside `sort=new`, so `since`
is applied by us; a subreddit that does not exist answers 200 with an empty list
and bills a credit for it; and the credential probe is free, measured against
the account's own credit balance and against `api_usage`, which held no row for
it.

**Deduplication across two providers is proven, live.** A ScrapeCreators poll
collected 47 posts from a subreddit Bright Data had already collected, and
stored no new row. Both connectors read Reddit's own `t3_` fullname —
`post_id` at one provider and `name` at the other — and `posts` is keyed by
`(source, external_id)` with the provider outside the key.

What is still unproven for this connector: a real rate limit, a real timeout,
and keyword discovery at any volume. The 429 branch is our half of a contract
the provider has not yet shown us.

**A person chooses which provider fetches a platform, and the common
deployment is never asked.** US-026 closed on 2026-09-05. A monitor names a
platform and its row records no provider, so `registry.only` decides, and
`decideProvider` is the one rule it and every screen read. The order is: a
recorded choice that can run wins; a recorded choice that cannot run is refused
rather than replaced; one provider that can run is its own answer; two that can
run and no choice is an error. "Can run" means this deployment holds the key,
which is why a build shipping two Reddit connectors asks nothing of an instance
holding one. `source_providers` is the store, one row per platform, and no row
is the normal state. `REDDIT_PROVIDER` is gone.

Three things follow, and each has a test. The choice is read per poll, so a
change takes effect on the next collection with no restart. It never reaches a
collection already running, because `source_continuations` carries the provider
that started one and the poll resumes through that provider — a cursor is a
snapshot id the other provider has never heard of. And `api_usage` is keyed by
the pair, so a switch splits the month's spend across two rows rather than
pricing one account's month at the other's rate.

**The switch has been made live, mid-collection.** On 2026-09-05
`live:provider-switch` triggered a Bright Data collection of r/softwaretesting,
moved the recorded choice to ScrapeCreators one second later while the snapshot
was still collecting, and watched what happened. All four resumes went back to
Bright Data with Bright Data's own cursor
(`subreddit|sd_mto9lmkh1w5v9syrux|0`); ScrapeCreators was never asked. The
snapshot closed after 2 minutes 13 seconds with 50 records for $0.075. Only
then did the next collection go to ScrapeCreators: 47 posts for 2 requests and
$0.00376. `api_usage` holds two rows, one per provider, each priced by the
connector that ran.

Two numbers came with it. **The same subreddit cost twenty times less through
ScrapeCreators**, measured back to back rather than on separate days. And
**Bright Data's snapshot was ready in 2 minutes 13 seconds**, against US-022's
8 minutes 40 — so that figure is a sample and not a constant.

The whole run stored no new post. All 50 records and all 47 posts were already
in the table from earlier runs, and `posts` stayed at 174: deduplication across
two providers, again, live.

**X has one provider, and the reason is that only one of three can search
it.** US-006 added SocialCrawl on 2026-09-05. Bright Data's X posts dataset
answers a discovery trigger with `Available types: profile_url,
profiles_array`, and ScrapeCreators publishes six X endpoints and no search
among them. Both fetch the posts of an account you name; neither finds a
stranger describing a problem. Both refusals came from the providers' own APIs,
not from their documentation, and both probes were free.

SocialCrawl bills a request and refunds one that matches nothing — measured
twice, at `credits_used: 0`. A request carried 20 posts, so an X post costs
about $0.0004: cheaper than a Bright Data Reddit record, and about one
thirtieth of X's own API. Its price is the only one here that carries an
exchange rate, because the provider bills in pounds.

Its capture answered four things the documentation did not. The cursor is at
`data.next_cursor` *and* at `pagination.next_cursor`, and the two strings
differ. `sort` takes `latest` or `top` and the documentation names only `top`.
A search that matches nothing is free. And **an empty answer is not always the
truth**: the same query returned nothing at 20:12 and twenty posts at 20:31,
both free, so no empty page may be read as a query being finished for good.

One product finding came with it, and it is not about the connector. On X a
long generated phrase is useless in both directions: unquoted, `end to end
tests keep breaking` returned anime, Bitcoin and a CIA story across three
weeks; quoted, it matched nothing at all, twice. The two-word `flaky tests`
returned twenty posts that were all on topic. US-027 is the fix, and it is
described below.

**A query is now written for one platform.** US-027 keyed the queries by
platform on 2026-09-05: `monitors.generated_queries` holds one list per
platform, the generator is told which platforms a monitor watches and writes a
list for each, and the poll hands a connector its own list and no other. A
`PlatformDescriptor` carries the rule — four words on X, eight on Reddit — and
one number is enforced everywhere a query is written or edited: the model's
schema, the API, and the form. The prompt gives the reason beside the number,
because a model told only a limit talks itself out of it.

Migration 0021 keyed every existing row by the platforms its monitor watches,
and it ran against the development database: six monitors, every query kept,
nothing rewritten. A monitor that names no platform keeps its array and still
polls, and both worker steps read that older shape.

What is not done: `ai/fixtures/query-plan.json` still holds a plan in the old
shape, so `capture:queries` has to run again before the fixture is evidence
about the prompt that ships. And no live search has been run with a query the
new prompt wrote.

What is unproven: no X poll has run through the worker, so nothing has been
stored, classified or shown from X. A real rate limit, a real timeout and a
real outage have only been simulated.

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

Two tickets are in `doing/`.
[US-015](backlog/doing/US-015-a-deleted-post-stops-being-shown.md) has the
scheduled deletion job, budget guard, durable provider continuations and post
tombstones. Bright Data returned explicit deletion evidence in live captures.
ScrapeCreators returned ambiguous answers for both live and removed posts, so
its uncertain checks leave matches visible. That acceptance box remains open.
Read docs/deletions.md before changing verification.
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
reports as failed, and a rate limit.

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
   It holds two lists — adding a provider, and adding a platform — and the
   three things connectors get wrong.
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
| A Reddit API key per user | Reddit through a provider: Bright Data or ScrapeCreators |
| X's own pay-per-use API | X through SocialCrawl, the one provider of three that can search X |
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
pnpm --filter @intentwatch/core live:provider-switch # spends ~$0.08; see below
pnpm capture:deletions                            # spends ~$0.02; see below
```

These five are the only commands here that spend money, and all five are
instruments: they ask a real provider something and record what it said,
because an answer we wrote would be evidence about our own schema and none
about the provider.

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

`live:provider-switch` is the fourth, and it is different in kind: it asks two
real social-data providers rather than a model, and it writes rows. It starts a
Bright Data collection, moves the recorded provider to ScrapeCreators while
that snapshot is still collecting, and reports which provider each resume went
to and what each one billed. It spends about $0.08 and leaves behind a paused
monitor and two `api_usage` rows, which are the evidence. Run it when
`collect.ts` changes how a provider is chosen or resumed.

`capture:deletions` checks known available, removed and missing Reddit URLs.
It retains whole provider responses with author identity scrubbed. The default
run asks both providers; `--comments` probes ScrapeCreators' alternate endpoint.
It writes fixture files and a request manifest, never application rows. Read
docs/deletions.md for what each provider has and has not proved.

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
