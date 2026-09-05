# Adding a source

A source has two axes, and US-024 separated them.

* A **platform** is what a person ticks: Reddit, X. It keys `posts.source`, it
  keys deduplication, and a monitor names it.
* A **provider** is who fetches, whose key it is, and what it bills: Bright
  Data, ScrapeCreators. One provider key serves every platform that provider
  fetches.
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
`packages/core/src/db/schema.ts` and run `pnpm db:generate`. Four columns carry
it — `api_usage`, `source_continuations`, `source_credentials` and `posts` —
and each has a check constraint. One migration number, one file.

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

## One platform, one provider — when only one can do the work

X has one provider and it was chosen by elimination, which is worth writing
down because the next person will assume it was preference.

US-006 asked all three. Bright Data's X posts dataset answers a discovery
trigger with `Available types: profile_url, profiles_array`, so it can fetch
the posts of accounts you name and cannot search. ScrapeCreators publishes six
X endpoints and none of them is a search. SocialCrawl has
`/v1/twitter/search/tweets`. A monitor exists to find a stranger describing a
problem, so a provider that cannot search cannot serve X here, however good it
is at Reddit.

Two consequences. `registry.only("x")` never has to choose, so no deployment is
asked a question about X. And a second X provider is not a small change: it
would have to search, and today two of the three cannot.

## Two providers for one platform

This is no longer hypothetical. US-025 gave Reddit a second provider on
2026-09-05, and both fetch the same subreddits.

The registry holds a connector under the pair, so `registry.get(platform,
provider)` is the exact address and `registry.only(platform, options)` is for a
caller that has a platform and no provider.

`decideProvider` is the rule, and it is written once. Four branches, in order:

1. **A recorded choice that can run wins.** `source_providers` holds one row
   per platform, the connections screen writes it, and `readProviderChoices`
   reads it. A choice is a decision and not a guess.
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

| | Bright Data | ScrapeCreators | SocialCrawl |
|---|---|---|---|
| Fetches | Reddit | Reddit | X |
| Billable unit | a record | a request | a request |
| Price | $1.50 / 1,000 records | $1.88 / 1,000 requests | $8.12 / 1,000 requests |
| One unit buys | one post | 7 to 23 posts, measured | 20 posts, measured |
| A call that finds nothing | billed | billed | refunded, measured |
| Shape | trigger, then poll a snapshot | the posts are in the answer | the posts are in the answer |
| A collection took | 8 minutes 40 seconds, and 2 minutes 13 on another day | 1.8 to 4.9 seconds | 1.5 to 5.3 seconds |
| A refused key says | `Invalid credentials`, as a bare string | `{"message":"Invalid API key"}` | `Invalid API key format. Keys start with 'sc_'.` |

SocialCrawl prices in pounds and every figure in this product is in
micro-dollars, so its price alone carries an exchange rate. `x.ts` names the
rate and the day it was read. [costs.md](costs.md) already says the spend is an
estimate; this is one more reason it is.

A connector reports `unitsConsumed` in its own unit and the budget guard prices
it from the connector's own `pricePerUnitMicros`. Nothing downstream reads the
table above.

---

## What the runtime is for

Every side effect a connector has arrives through `SourceRuntime`: `fetch`,
`now`, `sleep`, `logger`. Nothing else. A connector that reaches
`globalThis.fetch` or `Date.now()` directly cannot be tested without the
network or without real time, and no test in this repository may reach Reddit,
X or a model provider. See [testing.md](testing.md).

---

## The three things connectors get wrong

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
