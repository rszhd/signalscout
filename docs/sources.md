# Adding a source

A source has two axes, and US-024 separated them.

* A **platform** is what a person ticks: Reddit, X, LinkedIn. It keys
  `posts.source`, it keys deduplication, and a monitor names it.
* A **provider** is who fetches, whose key it is, and what it bills: Bright
  Data, ScrapeCreators, SocialCrawl. One provider key serves every platform
  that provider fetches.
* A **connector** is the pair, and it is what the registry holds.

Until two providers fetched the same platform, one record could describe both.
Two cannot share a price, a billable unit or a key list, so they are separate
records now. `packages/core/src/sources/types.ts` holds the interface, and its
comments say which axis owns each field.

The two lists below are short on purpose: if adding either needs more than
this, the interface is wrong and the fix belongs in the interface.

---

## Adding a provider for a platform we already fetch

This is the common case, and it touches no platform and no schema.

**1. Make one folder.** `packages/core/src/sources/providers/<provider id>/`.
The id is lower-case letters, digits and hyphens, and it never changes: it
reaches `source_credentials.provider` and the environment variable that holds
the key.

**2. Export one `ProviderDescriptor`.** Who the provider is, and the fields a
person pastes. The list is the provider's, not the platform's — one key serves
every platform this provider fetches, so it is written once and rotated once.

```ts
export const brightDataProvider: ProviderDescriptor = {
  id: "brightdata",
  displayName: "Bright Data",
  credentialFields: [{ name: "apiKey", label: "Bright Data API key", secret: true }],
};
```

**3. Export one `ConnectorDefinition` per platform it fetches.** The pair, plus
what that pair bills, plus a `create` that takes a `SourceRuntime` and returns
a `SocialSource`.

```ts
export const brightDataReddit: ConnectorDefinition = {
  platform: redditPlatform,
  provider: brightDataProvider,
  billableUnit: "record",
  pricePerUnitMicros: 1500,
  maxUnitsPerQueryPoll: 50,
  create: (runtime) => new RedditSource(runtime),
};
```

The three money fields belong to the pair and never to the platform alone.
Bright Data prices a Reddit record at $0.0015 and another provider will not
price the same record the same, so a number kept on the platform would be one
provider's arithmetic on every provider's bill.

`maxUnitsPerQueryPoll` is the most one query can collect in one poll when the
caller sets no limit. US-014's cost test uses it as the top of the range it
reports for a query whose sample came back full: a sample of ten that was
billed ten says only "there was more", and this says how much more there could
be.

**4. Add one line to `builtInSources`** in
`packages/core/src/sources/index.ts`, per connector.

**5. Add the provider id to `providers`** in
`packages/core/src/db/schema.ts` and run `pnpm db:generate`. Six columns carry
it, each with its own check constraint: `api_usage`, `source_continuations`,
`source_credentials`, `posts` (attribution only), `query_estimate_probes` and
`source_providers`. One migration number, one file.

**Do this, and do not assume a green suite noticed.** US-057 shipped the Apify
connector without adding `apify` here: 1,228 tests passed, the connector
collected 25 real posts, and every insert failed. `assertSourcesCanBeStored`
checks platforms and nothing checks providers, so a connector can be
registered, tested and unable to write a row.

That is the whole change. Nothing that consumes a source needs a case for it:
the collector pages it through `next`, the budget guard prices it from
`pricePerUnitMicros`, the cost test projects a month from the units a search
reports, and the connections screen renders the provider's
`credentialFields`. `packages/core/src/sources/adding-a-connector.test.ts` is
that claim written as code — a complete connector, driven by caller code that
never names it.

---

## Adding a platform

**1. Describe it in `packages/core/src/sources/platforms.ts`.** An id and a
display name, and nothing else. A platform holds nothing about money and
nothing about keys, because two providers fetching it agree about neither.

**2. Write a migration for `posts.source`.** It carries a check constraint
listing the platforms the schema accepts. Add the id to `sources` in
`packages/core/src/db/schema.ts`, run `pnpm db:generate`, and keep the rule:
one migration number, one file.

`assertSourcesCanBeStored` turns the mistake into a failed boot rather than a
failed insert at 02:00. Call it where the connector is wired in.

**3. Write at least one connector for it**, by the list above. A platform with
no provider is a platform nothing can fetch.

---

## One provider, six platforms

SocialCrawl fetches X and LinkedIn since US-028, Reddit since US-031, YouTube
since US-034, TikTok since US-044 and Instagram since US-049, and that is the
case `ProviderDescriptor` was split out for. Its LinkedIn connector has been
switched off since US-053 on 2026-09-09 — Apify fetches that platform now — so
five of its six are offered. Everything this section says still holds: the key,
the card and the rotation are one for all six. The credential fields are written once
and the connections screen shows one card, so a person pastes that key once and
rotates it once however many platforms sit behind it.

What is *not* shared is anything about money or shape. The two endpoints differ
in their price per call, their cursor, their sort order, how they take a date
window, and what they do with a search that matches nothing. `client.ts` holds
one transport and an `EndpointProfile` per platform for the three things that
differ; everything else is a connector's own business.

The lesson is worth keeping every time a platform arrives at this provider:
sharing a key is not sharing a contract. Ask the new endpoint every question
the capture script asks, even the ones the sibling endpoint already answered.
US-028 asked nine, and four of the answers contradicted the X connector.

**US-049 is the strongest case for that rule so far**, because Instagram broke
three things its four siblings agree on, and each would have shipped as a silent
fault:

* **A search with no date window returns five years of posts.** Thirty results
  ran from 2021 to 2026 in relevance order and the newest was five months old,
  so a monitor's `since` would have thrown away everything it was billed for,
  every poll. Instagram is the one connector here that always sends a window;
  LinkedIn deliberately sends none in the same situation.
* **`has_more` is true beside an empty page.** The cursor from a full first page
  returned zero items, zero credits and another `has_more: true`. Reading the
  flag is an endless walk over nothing.
* **Three of the nine comment fields are null on every comment**: `url`,
  `post_id` and `author.display_name`, against 137 captured comments from X,
  YouTube and TikTok that fill all three. So the shared parser now falls back to
  the handle for a name, and BUG-007's wrong-parent check is **inert on
  Instagram** — there is no `post_id` to disagree with.

The prices differ inside one platform too, which is new here. A reel search is
1 credit and a comment page is 5, so this connector declares
`replyPricePerUnitMicros` separately from `pricePerUnitMicros`. US-028 found
that trap on LinkedIn: where a request and a credit are different numbers, a
guard fed the wrong one lets a monitor spend five times its cap.

## When only one provider can do the work

X is the case worth remembering, because it was one provider for a reason
rather than by preference — and the reason has since half expired.

US-006 asked all three accounts we already held. Bright Data's X posts dataset
answers a discovery trigger with `Available types: profile_url,
profiles_array`, so it fetches the posts of accounts you name and cannot
search. ScrapeCreators publishes six X endpoints and none of them is a search.
SocialCrawl has `/v1/twitter/search/tweets`. A monitor exists to find a
stranger describing a problem, so a provider that cannot search cannot serve X
here, however good it is at Reddit.

**X has two providers now.** US-061 added SocialData on 2026-09-07, and it did
not weaken that rule — it searches. So the conclusion to carry forward is the
question, not the count: before adding a provider for a platform, ask whether
it can discover a stranger, and not only whether it can fetch a URL.

**Three platforms were measured at a second provider on 2026-09-11**, after
the owner asked for two everywhere: TikTok and YouTube are worth building at
ScrapeCreators and have tickets, and Instagram is worth building there only if
a Google-indexed index is acceptable as the *second* provider — the question
US-055 answered no to when it was the *only* one. The evidence is in US-119,
US-120 and US-121, and the capture scripts beside their fixtures re-ask
everything.

**LinkedIn is the opposite case, and the two must not be written down the same
way.** US-028 used SocialCrawl because it already had the key and the provider
documents `/v1/linkedin/search/posts`. Bright Data and ScrapeCreators were
never asked what they can do with LinkedIn. That is one provider by
convenience, not by elimination — an open question rather than a closed one —
and US-056 later measured three providers for that platform and US-057 shipped
a second.

## Two providers for one platform

This is no longer hypothetical. US-025 gave Reddit a second provider on
2026-09-05, and both fetch the same subreddits.

The registry holds a connector under the pair, so `registry.get(platform,
provider)` is the exact address and `registry.only(platform, options)` is for a
caller that has a platform and no provider.

`decideProvider` is the rule, and it is written once. Four branches, in order:

1. **A recorded choice that can run wins.** `source_providers` holds one row
   per platform per account, the connections screen writes it, and
   `readProviderChoices` reads it. A choice is a decision and not a guess.

   **Whose choice, is the question every reader must answer.** BUG-010: the
   table was keyed by the platform alone until 2026-09-10, so on an instance
   taking registrations one account's choice decided what every other account
   polled through — and by rule 2 below a choice that cannot run is refused
   rather than replaced, so a stranger could stop somebody's monitors dead. A
   poll therefore reads the choice of the **monitor's owner**, never of whoever
   is signed in, the same way `worker/credentials.ts` reads their key. The
   function takes the owner as an argument, so there is no way to read the
   table without answering the question.
2. **A recorded choice that cannot run is refused**, never replaced. A person
   who chose ScrapeCreators and lost its key would otherwise have every poll
   billed to Bright Data, which charges twenty times as much for the same
   subreddit page.
3. **One provider that can run is its own answer.** No question is asked. This
   is every deployment holding one key, which is the common case.
4. **Two that can run and no choice is an error.** Answering from registration
   order would spend somebody's money at a provider they did not pick.

"Can run" is the caller's word, passed as `ChoiceOptions.among`. The poll fills
it with the providers it holds a key for, so the build shipping two Reddit
connectors never makes a one-key deployment answer a question. A screen that is
describing the build rather than running it leaves it out.

A choice naming a provider that does not fetch the platform at all is a stale
or mistyped row, so it decides nothing and the rules answer as if it were
absent. It still cannot pick for a platform two providers can run.

The choice is read **per poll**, not at boot, so changing it takes effect on
the next collection and needs no restart. It never reaches a collection that is
already running: `source_continuations` carries the provider that started one,
and `collect.ts` resumes through that provider whatever the choice now says.
The cursor is a snapshot id the other provider has never heard of, and on a
provider that bills at collection time, re-running the query pays for it twice.
`query_estimate_probes.provider` is the same rule for a cost test's sample.

That was measured, not argued. On 2026-09-05 `live:provider-switch` started a
Bright Data collection of r/softwaretesting, moved the recorded choice to
ScrapeCreators one second later, and watched the snapshot finish. All four
resumes went to Bright Data with Bright Data's own cursor; ScrapeCreators was
asked nothing until the collection closed. Re-run that script when this rule
changes — it spends about $0.08 and it is the only thing that can say whether
two real providers still behave this way.

Two connectors for one platform must agree about the id they give a post, or
the same post becomes two rows. Both Reddit connectors read Reddit's own `t3_`
fullname — Bright Data calls it `post_id` and ScrapeCreators calls it `name`.
That was proven live: a poll through ScrapeCreators collected 47 posts from a
subreddit Bright Data had already collected, and stored no new row.

**The two providers agree about almost nothing else**, which is the argument
for the split:

| | Bright Data | ScrapeCreators | SocialCrawl | SocialData | Apify |
|---|---|---|---|---|---|
| Fetches | Reddit | Reddit | Reddit, X, YouTube, TikTok, Instagram — and LinkedIn, switched off since US-053 | X | LinkedIn |
| Billable unit | a record | a request | a credit: 1 on X, Reddit, YouTube and TikTok, 5 on LinkedIn and an Instagram comment page | a tweet | a post, settled from the run's own total |
| Price | $1.50 / 1,000 records | $1.88 / 1,000 requests | $8.12 / 1,000 credits | $0.20 / 1,000 tweets | $2.00 / 1,000 posts |
| One unit buys | one post | 7 to 23 posts, measured | 20 X posts, 25 Reddit posts, 45 YouTube videos, 30 reels — or 15 Instagram comments for five credits | one tweet | one post |
| A call that finds nothing | billed | billed | refunded on X search and on a scoped Reddit search; billed in full on LinkedIn, which returns unrelated posts rather than none | billed, outside the free allowance | billed — a run that matches nothing still costs its start event |
| Shape | trigger, then poll a snapshot | the posts are in the answer | the posts are in the answer | the posts are in the answer | start an actor run, then read it |
| A collection took | 8 minutes 40 seconds, and 2 minutes 13 on another day | 1.8 to 4.9 seconds | 1.4 to 5.3 seconds | under 2 seconds | 3 to 11 seconds |
| A refused key says | `Invalid credentials`, as a bare string | `{"message":"Invalid API key"}` | `Invalid API key format. Keys start with 'sc_'.` | 401, and an empty balance is **402** — a different repair | the actor refuses the run |

**Two of them carry a trap the other three do not.** SocialData is prepaid, so
an empty balance answers 402 — not a wrong key and not a rate limit, and
retrying will not help. Apify settles the bill *after* the run ends, so a total
read too early prices every poll at a fraction of a cent and refuses nothing,
for ever.

**One provider does not bill one way.** SocialCrawl is the row that proves the
three money fields belong to the *pair* and never to the provider: the same key
and the same credit price, and an X call spends one credit where a LinkedIn
call spends five. That is why the X connector reports requests and the LinkedIn
connector reports credits — one unit each, each the one its own price is
written against.

SocialCrawl prices in pounds and every figure in this product is in
micro-dollars, so its price alone carries an exchange rate. `x.ts` names the
rate and the day it was read. [costs.md](costs.md) already says the spend is an
estimate; this is one more reason it is.

A connector reports `unitsConsumed` in its own unit and the budget guard prices
it from the connector's own `pricePerUnitMicros`. Nothing downstream reads the
table above.

---

## Switching a connector off

A connector can ship and not be offered. `ConnectorDescriptor.notOffered` is
the whole switch: one sentence saying why, on one connector definition, and
nothing else changes. US-053 built it and LinkedIn through SocialCrawl was its
first caller, on 2026-09-09.

**Write the sentence for the person who meets it.** It reaches three places: a
`422` refusing a monitor that names the platform, a `400` refusing a cost test,
and the log line where a poll skips it. So say what is wrong and what fetches
the platform instead. A boolean would say "off", which is a bug report.

**Deleting the line from `builtInSources` is not the same thing, and it is
worse.** It hides the platform from the monitor form and leaves three doors
open. The API takes its platform list from the `posts.source` enum, not from
the registry, so a `POST /api/monitors` naming the platform is still written.
`startBlockers` reports nothing for a platform with no connector, so that
monitor reads as startable. Then the poll throws `UnknownSourceError` at 02:00,
and nobody sees a refusal — they see a monitor that collects nothing.

### What happens to what already exists

* **A monitor that names the platform still runs.** The poll skips that
  platform with the reason in the log and collects every other one. A decision
  somebody made about a connector is not an error in a job.
* **A collection already bought is still read.** `source_continuations` names
  the provider that started it, and `registry.get` still answers for a
  switched-off pair. Refusing there would throw away money already spent. The
  same holds for a cost test's sample and for deletion verification.
* **The rows stay.** Posts, matches, verdicts and `api_usage` are untouched,
  and the platform stays in `sources/platforms.ts` and in the `posts.source`
  enum. Nothing is deleted, so nothing has to be migrated.
* **A recorded choice naming it is refused, never replaced.** This is the money
  case. `decideProvider` treats a switched-off provider as one that cannot run,
  which is branch 2 above: falling back to whoever is left would bill an
  account the person never chose. The connections screen says so, and names the
  provider to choose instead.

### What disappears

`groupByPlatform` leaves a switched-off connector out, so the monitor form and
the connections rows both lose it with no branch of their own. A platform whose
**every** connector is switched off disappears from both screens, from the
pricing comparison, and from the platforms a query is generated for.

A provider whose every connector is off loses its card on the connections
screen too. That is right: there would be nothing to spend the key on.

### The way back

Delete the field. Nothing else was changed, so nothing else has to be undone —
the file, the parser, the fixtures, the capture script and the connector's own
tests all stayed. Write into the sentence what would have to be measured for it
to come back, because that is the note the next person needs.

**A live poll script that drives the real pipeline will refuse a switched-off
connector**, because it goes through `registry.only` like everything else.
Switch the connector back on to re-measure it.

There is no per-deployment override, deliberately. This switch is the build's
decision, made once for everybody, and an environment variable reversing it
would be a second answer to the same question — the shape US-026 removed when
it deleted `REDDIT_PROVIDER`. If a self-hoster ever needs a connector this
build does not offer, `source_providers` is the precedent: a row, chosen on a
screen. Nobody has asked yet.

---

## A query belongs to a platform

`SourceQuery.queries` is the list written for the platform being polled, and
never the monitor's whole set. `monitors.generated_queries` holds one list per
platform, `monitorQueries(value, platform)` reads one of them, and the poll
calls it inside its loop over sources.

The rule each platform holds a query to lives on its `PlatformDescriptor`:

```ts
search: { maxQueryWords: 4, note: "An X post is a few sentences, so a long phrase..." }
```

A connector never edits a person's words to fit. US-006 is why: on X the same
six-word phrase returned unrelated posts unquoted and nothing at all quoted,
and a connector that quietly shortened it would have hidden that from everyone.
The generator writes for somewhere; the connector asks for what it was given.

## What the runtime is for

Every side effect a connector has arrives through `SourceRuntime`: `fetch`,
`now`, `sleep`, `logger`. Nothing else. A connector that reaches
`globalThis.fetch` or `Date.now()` directly cannot be tested without the
network or without real time, and no test in this repository may reach Reddit,
X or a model provider. See [testing.md](testing.md).

---

## What connectors get wrong

**Cost is not the post count.** One provider bills a call that returns up to
100 posts; another bills every record; a third refunds the call that finds
nothing. `unitsConsumed` is the connector's answer, in
its own `billableUnit`, and the caller must not compute it.

**The rate limit is yours, not the caller's.** Every provider says it
differently, and one of ours has never said it at all. Read the signal here and
back off here. When the wait is longer
than you are willing to hold the job, return
`next: { status: "wait", retryAfter, cursor }` and let the scheduler do
something else. The caller learns *when* to come back and never *how* you knew.

Give that wait a cursor whenever coming back means reading work already
started. The collector stores it in `source_continuations` and calls you again
with it, so the wait costs one row and not a second collection. A wait with no
cursor means the query starts from the beginning, which on a provider that
bills at collection time is a second bill. BUG-001 is what a dropped cursor
cost.

**A short page is not the last page.** Return fewer posts than the caller asked
for whenever you want to. The caller reads `next`, never `posts.length`. Every
connector must be able to prove this, which is why the fake can be told to do
it.

**Ask the provider before you pay it.** Two techniques cost nothing and both
were found late, after captures had paid to answer questions that were already
written down.

An **invalid parameter value** makes a provider name its own vocabulary. A
rejected call bills nothing, and `Invalid value for 'order': ... Allowed
values: top, newest` is a complete answer for free. Use it whenever the
documentation is silent about what a parameter accepts.

SocialCrawl goes further and publishes a guide per endpoint:

    GET /v1/utility/endpoint?id=tiktok/post/comments

It returns every required and optional parameter, the credit cost, the paging
style, the caching rule and the billing rules, at **zero credits**. Read it
before writing a connector, and before believing anything a capture inferred.

**A parameter a provider accepts is not a parameter that works.**
ScrapeCreators' Reddit comments endpoint takes `sort`, understands `new` and
`top`, and answers both with **zero comments while billing a credit** — where
the same call without it returns the thread. An unrecognised value is ignored
and behaves correctly, so the broken case is the one the provider knows. Test
a parameter's effect on real output, not on the status code.

**A thread's window is not the poll's window.** `ReplyRequest.since` is how far
back this *thread* has been read, and it has nothing to do with when the
monitor last searched. The two were the same value until BUG-006, and the
result was that every provider was asked for comments written after the poll
had already started: 25 threads bought, nothing stored. A post found today can
carry comments from 2015, and `posts.replies_read_at` is the only mark that
says how much of one we hold.

Apply it yourself, and say so in the connector. Two of the four providers offer
no date parameter on a comment endpoint at all, so the cut is ours in every
case and the bill is the same either way.

---

## Testing a connector

Fixtures for someone else's API are **captured, not written**. Commit the
capture script beside the fixture, store the payload whole, and scrub the
identifying fields. A payload written from memory is evidence about our parser
and no evidence at all about the wire format. [testing.md](testing.md) has the
case that proves it.

`biome.json` excludes `sources/*/fixtures/*.json` from formatting. A captured
payload is evidence about someone else's API; a formatter that rewrites it
makes the file a record of our tooling instead.

`sources/providers/brightdata/fixtures/capture.mjs` is the worked example. Its
first run answered three questions the provider's own documentation got wrong,
which is the whole argument for capturing rather than writing.

`sources/providers/socialcrawl/linkedin-fixtures/capture.mjs` is the third, and
its first run corrected itself before anything was committed: the scrubber let
real names and real job headlines through, because it decided what a person was
by sniffing for fields this provider does not use. It puts a person under
`author` as `{ name, description, url, avatar }`, and none of those tripped the
rule. Name the container, do not guess at its contents — and read the fixtures
your own script wrote before you commit them.

`sources/providers/scrapecreators/fixtures/capture.mjs` is the second, and it
answered four more. Three were not in the documentation at all: the API is
synchronous, a `timeframe` is refused beside `sort=new`, and a subreddit that
does not exist answers 200 with an empty list and bills for it. The fourth is
what a credential probe costs, and that one is not a thing a connector may
assume — so the script writes `ledger.json` beside the fixtures, recording what
each captured call did to the account's credit balance. A claim that a check is
free is a claim about somebody's bill, and the ledger is the evidence for it.

The fake source is the exception, and it is not one: its fixtures are
`CandidatePost` values, which is our own shape. Use it to test everything
downstream of a connector. It can be told to run out of allowance and to hand
back a short page, so a caller can be tested against both without a network and
without a bill.

## Verifying deletion

US-015 adds an optional `SocialSource.verify` method. It receives a post id,
its URL, credentials, and an optional opaque cursor. It returns `available`,
`deleted`, `unknown`, or `pending`, with `unitsConsumed` on every answer.
`pending` supplies a retry time and may carry a cursor. The worker persists
that cursor beside its provider and paying monitor, independently of search
continuations. A provider switch cannot move it.

Only a definite deletion may return `deleted`. An empty result, missing
record, outage, inaccessible post, or unsupported method does not establish
one. In particular, a ScrapeCreators 404 was captured for an available post
with a shortened URL. See [deletions.md](deletions.md) and the committed
`capture:deletions` instrument before changing a deletion rule.

Verification currently uses the connector's existing billable unit and price.
A provider whose verification endpoint bills differently must declare that
price separately before it can be used; the worker must never guess one.
