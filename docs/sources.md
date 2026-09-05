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

## Two providers for one platform

The registry holds a connector under the pair, so `registry.get(platform,
provider)` is the exact address and `registry.only(platform)` is for a caller
that has a platform and no choice recorded yet. `only` throws when a platform
has two providers, because registration order is not a choice: answering with
the first would spend somebody's money at a provider they did not pick. The day
a second provider ships, `only`'s callers are the list of places that have to
be given the choice.

---

## What the runtime is for

Every side effect a connector has arrives through `SourceRuntime`: `fetch`,
`now`, `sleep`, `logger`. Nothing else. A connector that reaches
`globalThis.fetch` or `Date.now()` directly cannot be tested without the
network or without real time, and no test in this repository may reach Reddit,
X or a model provider. See [testing.md](testing.md).

---

## The three things connectors get wrong

**Cost is not the post count.** Reddit bills one call and returns up to 100
posts. X bills every post read. `unitsConsumed` is the connector's answer, in
its own `billableUnit`, and the caller must not compute it.

**The rate limit is yours, not the caller's.** Reddit sends `X-Ratelimit-*`
headers; X does not. Read them here and back off here. When the wait is longer
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

`sources/providers/brightdata/fixtures/capture.mjs` is the worked example. Its first run
answered three questions the provider's own documentation got wrong, which is
the whole argument for capturing rather than writing.

The fake source is the exception, and it is not one: its fixtures are
`CandidatePost` values, which is our own shape. Use it to test everything
downstream of a connector. It can be told to run out of allowance and to hand
back a short page, so a caller can be tested against both without a network and
without a bill.
