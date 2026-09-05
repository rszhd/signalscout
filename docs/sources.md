# Adding a source

A source is a connector: the code that turns one social network into
`CandidatePost` values, reports what the fetch cost, and manages its own rate
limit. `packages/core/src/sources/types.ts` holds the interface, and its
comments say why each member exists.

This page is the steps. It is short on purpose: if adding a connector needs
more than this, the interface is wrong and the fix belongs in the interface.

---

## The steps

**1. Make one folder.** `packages/core/src/sources/<id>/`. The id is lower-case
letters, digits and hyphens, and it never changes: it reaches URLs, columns and
saved monitors.

**2. Export one `SourceDefinition`.** The static facts, plus a `create` that
takes a `SourceRuntime` and returns a `SocialSource`.

```ts
export const redditSourceDefinition: SourceDefinition = {
  id: "reddit",
  displayName: "Reddit",
  billableUnit: "record",
  pricePerUnitMicros: 1500,
  maxUnitsPerQueryPoll: 50,
  credentialFields: [{ name: "apiKey", label: "Bright Data API key", secret: true }],
  create: (runtime) => new RedditSource(runtime),
};
```

`maxUnitsPerQueryPoll` is the most one query can collect in one poll when the
caller sets no limit, and it belongs to the connector for the same reason the
price does. US-014's cost test uses it as the top of the range it reports for a
query whose sample came back full: a sample of ten that was billed ten says
only "there was more", and this says how much more there could be.

**3. Add one line to `builtInSources`** in `packages/core/src/sources/index.ts`.

That is the whole change. Nothing that consumes a source needs a case for it:
the collector pages it through `next`, the budget guard prices it from
`pricePerUnitMicros`, the cost test projects a month from the units a search
reports, and the settings form renders `credentialFields`.
`packages/core/src/sources/adding-a-connector.test.ts` is that claim written as
code — a complete connector, driven by caller code that never names it.

**4. If its posts are stored, write a migration.** `posts.source` carries a
check constraint listing the sources the schema accepts. This is the one thing
step 3 does not cover. Add the id to `sources` in
`packages/core/src/db/schema.ts`, run `pnpm db:generate`, and keep the rule:
one migration number, one file.

`assertSourcesCanBeStored` turns the mistake into a failed boot rather than a
failed insert at 02:00. Call it where the connector is wired in.

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

`sources/reddit/fixtures/capture.mjs` is the worked example. Its first run
answered three questions the provider's own documentation got wrong, which is
the whole argument for capturing rather than writing.

The fake source is the exception, and it is not one: its fixtures are
`CandidatePost` values, which is our own shape. Use it to test everything
downstream of a connector. It can be told to run out of allowance and to hand
back a short page, so a caller can be tested against both without a network and
without a bill.
