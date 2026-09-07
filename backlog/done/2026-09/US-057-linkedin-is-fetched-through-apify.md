---
id: US-057
title: LinkedIn is fetched through Apify
type: feature
priority: p2
created: 2026-09-07T14:20+08:00
parent:
area:
resolution: shipped
---

## Context

**US-056 measured HarvestAPI's actor and recommended building it, and the
reason is freshness rather than price.** Every post in the capture was under
ninety minutes old — a 71-minute page — where ScrapeCreators' newest was three
days and SocialCrawl orders by relevance across weeks. At $0.10 for fifty posts
on a free Apify plan this is ten times ScrapeCreators and half of SocialCrawl.

**Apify is a provider this repository has never had**, so this is the *adding a
provider* list in docs/sources.md and not the one-file *adding a connector*
one: a descriptor, a client, a credential probe, and a connector. The
credential field is `apiToken`, which makes `environmentVariableFor` produce
`APIFY_API_TOKEN` — the name already in `.env`.

**The run is asynchronous, and a resumed poll must not start a second one.**
Start a run, poll it, read its dataset. Runs took 3.3, 6.6 and 10.5 seconds, so
this is nothing like Bright Data's minutes, but the shape is the same and
BUG-001's lesson applies exactly: a poll that is interrupted and resumed has to
finish the run it started, because starting another one pays for the same posts
twice. The run id therefore lives in the cursor, and `source_continuations`
already survives a restart with it.

**Four measured facts the connector has to respect.**

*`sortBy: "date"` selects recent posts but does not order them.* The captured
ten came back 04:43, 04:30, 04:29, 05:15, 05:14, 04:48, 04:37, 04:11, 04:04,
05:12. So no page may be read as older than the next, and the early-stop rule
that is right on `x.ts` is absent here as it is on both other LinkedIn
connectors.

*The bill settles after the run ends.* The run object reported `usageTotalUsd:
0.00005` for a run that had just returned ten posts, and $0.02005 a few seconds
later. **A budget guard fed the first number would never refuse anything.** The
client waits for the total to stop moving, and `unitsConsumed` comes from the
settled figure.

*A run's cost is not only its posts.* Every run is charged a $0.00005 start
event, and a run that matches nothing is charged $0.001 for a `no-result`
event. Counting posts alone would report an empty poll as free.

*The id is the activity id*, so a post already collected through SocialCrawl
must not be stored again through this one.

## Acceptance

- [x] An `apify` provider descriptor exists, with `apiToken` as its credential
      field, and the connections screen offers it
- [x] A `linkedin` connector on that provider is registered beside the
      SocialCrawl one, and the monitor form still shows one LinkedIn row
- [x] A poll starts one run, and a poll resumed from a cursor reads the run
      that cursor names rather than starting another
- [x] `unitsConsumed` comes from the settled bill, and a test pins that reading
      the run at completion time would have under-reported it
- [x] A run that returns nothing still reports what it cost
- [x] The external id is the activity id, and a test asserts it matches what
      the SocialCrawl parser produces for the same post
- [x] Paging never stops early because a page looks old
- [x] `canFetchReplies` reflects what this connector actually does
- [x] A refused token is a credential answer, not an outage, and the probe
      spends nothing
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
      expected value moves except LinkedIn's provider count

## Notes

- The fixtures and every number are in
  [US-056](../done/2026-09/US-056-linkedin-is-measured-at-apify.md) and in
  `providers/apify/linkedin-fixtures/`.
- **`maxPosts: 0` means every post there is.** Never send it.
- Do not enable `scrapeComments` or `scrapeReactions`. They are a separate
  charge, and whether LinkedIn comments carry leads is a later question.
- `builtInSources` order is what every screen shows. Register beside
  `socialCrawlLinkedIn`, or LinkedIn moves up the monitor form. US-055 found
  that the hard way.
- The window is still unanswered — `postedLimit: "week"` could not narrow a
  71-minute page. Send it anyway when `since` allows, and say in the code that
  it is unproven.
- [US-053](../todo/US-053-a-connector-ships-without-being-offered.md) comes
  after this, and switching SocialCrawl off is what it is for.

## Log

- 2026-09-07T14:20+08:00 — Written on US-056's recommendation.

- 2026-09-07T14:10+08:00 — Built and closed. **1,228 tests pass, lint and
  typecheck clean**, and the only expected value that moved is LinkedIn's
  provider count, from one to two.

  A provider descriptor, a client and a connector, plus 40 tests driven against
  US-056's fixtures. The client is the interesting half: it owns the settle
  wait, and a test pins that reading the run at completion time would have
  reported eleven posts of spending as one.

  **The leak test caught a real gap.** `secrets/leak.test.ts` asserts that every
  credential field the shipped connectors ask for is in `logger.ts`'s redaction
  list, and `apiToken` was not — `apiKey` above it would not have covered it,
  and neither would the bare `token` entry, which matches a key called exactly
  that. An Apify token could have reached a log line. That test exists because a
  list nothing checks drifts from the field names the code uses, and this is the
  first time it has earned its keep.

  Two things are deliberately not done. **Paging is not implemented**: the
  actor's `startPage` and `scrapePages` were never exercised by the capture, and
  an unproven paging parameter is not something to spend somebody's money
  discovering. One run per query, twenty-five posts. And **comments are off**,
  though the actor supports them at the same price as a post and offers a
  `commentsPostedLimit` filter no other provider here has — whether a LinkedIn
  comment carries a lead is unmeasured, and turning on a per-item charge to find
  out is a ticket rather than a default.

  One correction to the ticket, found in the actor's input schema rather than
  its store page: **`postedLimit` has seven usable values**, not the four the
  page lists. Reading the schema is the difference between a window that narrows
  and a parameter the actor rejects.

  **Nothing has polled live through this connector.** The parser, the cursor,
  the settle wait and the refusals are all driven from captured payloads. A real
  run through the worker, a real rate limit, a real timeout and a second poll
  proving deduplication are all unproven.
