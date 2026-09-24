# Adding a source

This page holds the rules. What was measured, and when, is in the Log of the
ticket that measured it.

A source has two axes, and US-024 separated them.

* A **platform** is what a person ticks: Reddit, X, LinkedIn. It keys
  `posts.source`, it keys deduplication, and a monitor names it.
* A **provider** is who fetches, whose key it is, and what it bills. One
  provider key serves every platform that provider fetches.
* A **connector** is the pair, and it is what the registry holds.

Two providers fetching one platform cannot share a price, a billable unit or
a key list, so the three are separate records.
`packages/engine/src/sources/types.ts` holds the interface, and its comments
say which axis owns each field.

The two lists below are short on purpose: if adding either needs more than
this, the interface is wrong and the fix belongs in the interface.

---

## Adding a provider for a platform we already fetch

This is the common case, and it touches no platform and no schema.

**1. Make one folder.** `packages/engine/src/sources/providers/<provider id>/`.
The id is lower-case letters, digits and hyphens, and it never changes: it
reaches `source_credentials.provider` and the environment variable that holds
the key.

**2. Export one `ProviderDescriptor`.** Who the provider is, and the fields a
person pastes. The list is the provider's, not the platform's — one key is
written once and rotated once, however many platforms sit behind it.

```ts
export const brightDataProvider: ProviderDescriptor = {
  id: "brightdata",
  displayName: "Bright Data",
  credentialFields: [{ name: "apiKey", label: "Bright Data API key", secret: true }],
  unitPriceMicros: 1500,
};
```

`unitPriceMicros` is the list price of one of the provider's own units, the
price its connectors' prices are built from. It is what `withInstancePrices`
scales from when an instance pays less (US-389). Leave it out only when a
connector turns a dollar bill into units at its own price, as Apify's does;
then no instance price can be applied to it, and one given is refused.

**3. Export one `ConnectorDefinition` per platform it fetches.** The pair,
what that pair bills, and a `create` that takes a `SourceRuntime` and returns
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

The money fields belong to the pair, never to the platform or the provider
alone. Two providers price the same post differently, and one provider prices
two platforms differently: SocialCrawl spends one credit on an X call and five
on a LinkedIn call, under one key and one credit price. Where a request and a
credit are different numbers, a guard fed the wrong one lets a monitor spend
five times its cap. Where replies cost differently from posts, declare
`replyPricePerUnitMicros` separately.

`maxUnitsPerQueryPoll` is the most one query can collect in one poll when the
caller sets no limit. The cost test uses it as the top of its range for a
query whose sample came back full.

**The client builds on `providers/core.ts`.** Its error subclasses
`ProviderError` with the kinds this provider can produce; `readAnswer` reads
every response; `retryAfterDate` turns a `Retry-After` header into a wait,
never longer than `maximumRetryAfterSeconds`. How the key travels and what
the body holds stay in the client, because that is where providers differ.

**4. Add one line to `builtInSources`** in
`packages/engine/src/sources/index.ts`, per connector.

**5. Add the provider id to `providers`** in
`packages/engine/src/vocabulary.ts` and run `pnpm db:generate` in
`packages/pipeline`. Six columns carry a check constraint built from that
array: `api_usage`, `source_continuations`, `source_credentials`, `posts`,
`query_estimate_probes` and `source_providers`. One migration number, one
file. **Nothing in the suite notices this omission**: US-057 shipped a
connector without it, 1,228 tests passed, 25 real posts were collected, and
every insert failed.

That is the whole change. Nothing that consumes a source needs a case for it,
and `packages/engine/src/sources/adding-a-connector.test.ts` is that claim
written as code.

---

## Adding a platform

**1. Describe it in `packages/engine/src/sources/platforms.ts`.** An id and a
display name, and nothing else. A platform holds nothing about money and
nothing about keys.

**2. Write a migration for `posts.source`.** Add the id to `sources` in
`packages/engine/src/vocabulary.ts`, run `pnpm db:generate` in
`packages/pipeline`, and keep the rule: one migration number, one file.
`assertSourcesCanBeStored` turns the mistake into a failed boot rather than a
failed insert at 02:00. Call it where the connector is wired in.

**3. Write at least one connector for it**, by the list above.

---

## Before adding a provider, ask two questions

**Can it discover a stranger?** A monitor exists to find a person describing a
problem. A provider that fetches the posts of accounts you name, and cannot
search, cannot serve a platform here however good it is at fetching.

**Sharing a key is not sharing a contract.** When a platform arrives at a
provider we already use, ask the new endpoint every question the capture
script asks, including the ones the sibling endpoint already answered. Every
time this was done the answers differed: a search with no date window that
returned five years of posts, a `has_more: true` beside an empty page, three
fields null on every comment that every sibling fills. `client.ts` holds one
transport and an `EndpointProfile` per platform for what differs.

**One provider is either by elimination or by convenience, and the two are
not written down the same way.** Say which. A platform with one provider by
convenience is an open question; by elimination, a closed one, with the
measurements in the ticket that eliminated the others — US-122 for LinkedIn,
US-160 for Instagram.

---

## Two providers for one platform

The registry holds a connector under the pair: `registry.get(platform,
provider)` is the exact address; `registry.only(platform, options)` is for a
caller that has a platform and no provider.

`decideProvider` is the rule, written once. Four branches, in order:

1. **A recorded choice that can run wins.** `source_providers` holds one row
   per platform **per account**, the connections screen writes it, and
   `readProviderChoices` reads it. A poll reads the choice of the **monitor's
   owner**, never of whoever is signed in, the same way `worker/credentials.ts`
   reads their key. The function takes the owner as an argument, so the table
   cannot be read without answering whose choice (BUG-010).
2. **A recorded choice that cannot run is refused**, never replaced. Falling
   back to whoever is left would bill an account at a provider the person did
   not pick, at a different price.
3. **One provider that can run is its own answer.** No question is asked.
4. **Two that can run and no choice is an error.** Registration order would
   spend somebody's money at a provider they did not pick.

"Can run" is the caller's word, passed as `ChoiceOptions.among`. The poll
fills it with the providers it holds a key for. A screen describing the build
rather than running it leaves it out. A choice naming a provider that does not
fetch the platform decides nothing.

**The choice is read per poll**, not at boot, so a change takes effect on the
next collection with no restart. **It never reaches a collection already
running**: `source_continuations` carries the provider that started one, and
`collect.ts` resumes through that provider whatever the choice now says. The
cursor is one provider's snapshot id, and on a provider that bills at
collection time, re-running the query pays twice.
`query_estimate_probes.provider` is the same rule for a cost test's sample.
`live:provider-switch` is the instrument that proves this; re-run it when the
rule changes.

**Two connectors for one platform must agree about a post's id**, or the same
post becomes two rows. Both Reddit connectors read Reddit's own `t3_` fullname
under the provider's own field name.

A connector reports `unitsConsumed` in its own `billableUnit` and the budget
guard prices it from the connector's own `pricePerUnitMicros`. Nothing
downstream reads a comparison table. Two providers carry a trap: SocialData
is prepaid and an empty balance answers **402**, not a wrong key and not a
rate limit; Apify settles the bill after the run ends, so a total read too
early prices every poll at a fraction of a cent and refuses nothing.

---

## Switching a connector off

`ConnectorDescriptor.notOffered` is the whole switch: one sentence saying why,
on one connector definition, and nothing else changes in production code.
Expect to move the **tests** that borrowed the connector as a sample.

**Write the sentence for the person who meets it.** It reaches a `422`
refusing a monitor, a `400` refusing a cost test, and the log line where a poll
skips it. Say what is wrong and what fetches the platform instead. Write into
it what would have to be measured for the connector to come back.

**Deleting the line from `builtInSources` is worse.** The API takes its
platform list from the `posts.source` enum, not from the registry, so a monitor
naming the platform is still written, `startBlockers` reports nothing, and the
poll throws `UnknownSourceError` at 02:00 with nobody seeing a refusal.

What happens to what already exists:

* A monitor that names the platform still runs; the poll skips that platform
  with the reason in the log.
* A collection already bought is still read: `registry.get` still answers for
  a switched-off pair, and so do a cost test's sample and deletion
  verification.
* The rows stay, and the platform stays in `platforms.ts` and the enum.
* A recorded choice naming it is refused, never replaced — branch 2 above.
  The connections screen says so and names the provider to choose instead.

`groupByPlatform` leaves a switched-off connector out, so the monitor form and
the connections rows lose it with no branch of their own. A platform whose
every connector is off disappears from both screens, from the pricing
comparison and from query generation; a provider whose every connector is off
loses its card.

There is no per-deployment override. The switch is the build's decision, and
an environment variable reversing it would be a second answer to the same
question, the shape US-026 removed. A live poll script refuses a switched-off
connector; switch it back on to re-measure.

---

## A query belongs to a platform

`SourceQuery.queries` is the list written for the platform being polled, never
the monitor's whole set. `monitors.generated_queries` holds one list per
platform and `monitorQueries(value, platform)` reads one. The rule each
platform holds a query to lives on its `PlatformDescriptor`:

```ts
search: { maxQueryWords: 4, note: "An X post is a few sentences, so a long phrase..." }
```

**A connector never edits a person's words to fit.** The generator writes for
somewhere; the connector asks for what it was given. A connector that quietly
shortened a phrase would hide from everyone that the phrase returned nothing.

## What the runtime is for

Every side effect a connector has arrives through `SourceRuntime`: `fetch`,
`now`, `sleep`, `logger`. Nothing else. A connector that reaches
`globalThis.fetch` or `Date.now()` directly cannot be tested without the
network or real time. See [testing.md](testing.md).

---

## What connectors get wrong

**Cost is not the post count.** `unitsConsumed` is the connector's answer, in
its own `billableUnit`, and the caller must not compute it.

**The rate limit is yours, not the caller's.** Read the signal here and back
off here. When the wait is longer than you will hold the job, return
`next: { status: "wait", retryAfter, cursor }`. Give that wait a cursor
whenever coming back means reading work already started: the collector stores
it in `source_continuations`, so the wait costs one row and not a second bill
(BUG-001).

**A short page is not the last page.** The caller reads `next`, never
`posts.length`. The fake can be told to hand back a short page so every caller
can prove it.

**Ask the provider before you pay it.** An invalid parameter *value* makes
most providers name their own vocabulary in a rejected, unbilled call.
SocialCrawl publishes a guide per endpoint at zero credits:

    GET /v1/utility/endpoint?id=tiktok/post/comments

Read it before writing a connector and before believing anything a capture
inferred. ScrapeCreators is the exception: it ignores and bills an invalid
value, so use its OpenAPI document instead.

**A parameter a provider accepts is not a parameter that works.** Test a
parameter's effect on real output, not on the status code. ScrapeCreators'
Reddit comments `sort` answers zero comments and bills a credit.

**A search that finds nothing is answered differently by every endpoint**:
thirty unrelated results and a bill, an honest empty page and a bill, a 404
and no charge. Capture the empty case.

**A thread's window is not the poll's window.** `ReplyRequest.since` is how
far back this *thread* has been read, and it has nothing to do with when the
monitor last searched (BUG-006). A post found today can carry comments from
2015, and `posts.replies_read_at` is the only mark of how much of it we hold.
Apply the cut yourself, and say so in the connector: no provider offers a
usable one.

---

## Testing a connector

Fixtures for someone else's API are **captured, not written**. Commit the
capture script beside the fixture, store the payload whole, scrub the
identifying fields, and read what your own script wrote before you commit it.
A payload written from memory is evidence about our parser and none about
the wire format. Scrub by naming the container (`author`), not by sniffing
for fields; one capture let real names through because the provider's shape
was not the one the scrubber guessed.

`biome.json` excludes `sources/*/fixtures/*.json` from formatting: a formatter
that rewrites a captured payload makes it a record of our tooling.

Record what each captured call did to the account's balance in a `ledger.json`
beside the fixtures. A claim that a probe is free is a claim about somebody's
bill, and the ledger is the evidence.

### Capturing one, in order

Every capture spends real money, so the order matters more than the speed.

1. **Find the script** beside the fixtures:
   `packages/engine/src/sources/providers/<provider>/<platform>-fixtures/capture.mjs`,
   or a `capture:*` script in `packages/engine/package.json` for a model. Read
   its header for the flags it takes — `--only=comments`, `--lean`,
   `--model=`.
2. **Read its cost line** in [instruments.md](instruments.md), *The captures*,
   and say the number out loud before running. Anything over a few cents is
   the owner's call, not yours.
3. **Run it with the key in the environment**, never on the command line,
   where it reaches the shell history.
4. **Read every file it wrote, before committing.** Search for names, handles
   and URLs that identify a person. Three captures leaked identity past a
   scrubber that looked right. When one does, fix the scrubber and re-capture
   — never hand-edit the payload, which makes it a record of our editing.
5. **Check `ledger.json`** says what each call cost, and that `manifest.json`
   merged rather than replaced.
6. **Replay**: run the test that reads the fixture. If an expected value
   moves, the behaviour changed — say which and why in the commit.
7. **Put the numbers and the date in the ticket's Log**, where the next
   person looking at the price will go.

The fake source's fixtures are `CandidatePost` values, our own shape. Use it
to test everything downstream of a connector; it can run out of allowance and
hand back a short page.

## Verifying deletion

`SocialSource.verify` is optional. It receives a post id, its URL, credentials
and an opaque cursor, and returns `available`, `deleted`, `unknown` or
`pending`, with `unitsConsumed` on every answer. The worker persists the
cursor beside its provider and paying monitor; a provider switch cannot move
it.

**Only a definite deletion may return `deleted`.** An empty result, a missing
record, an outage, an inaccessible post or an unsupported method does not
establish one — a ScrapeCreators 404 was captured for an available post. See
[deletions.md](deletions.md) and `capture:deletions` before changing a
deletion rule.

Verification uses the connector's billable unit and price. A provider whose
verification endpoint bills differently must declare that price before it can
be used; the worker never guesses one.
