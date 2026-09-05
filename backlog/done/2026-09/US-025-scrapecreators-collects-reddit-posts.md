---
id: US-025
title: ScrapeCreators collects Reddit posts
type: feature
priority: p1
created: 2026-09-05T15:23+08:00
parent:
area:
resolution: done
---

## Context

ScrapeCreators is the second provider. The product reason is that a person
should reach several networks with one key and one account, and Bright Data is
then the alternative rather than the requirement.

This ticket adds the provider for **Reddit only**, and it does that on purpose.
Reddit is the one path this repository has measured: US-022 carried a monitor
from the form to twenty scored matches through Bright Data, live. Adding a
second provider on that path means provider switching is proven against a
result we already trust. Adding it on a platform we have never collected would
prove nothing about either half.

**We have no measured evidence about ScrapeCreators.** Not the price, not the
billable unit, not whether a search answers at once or returns something to
poll, not the cursor shape, not what a refused key says. Every one of those is
a question this ticket answers with a captured response, and none of them may
be written from memory. A payload written from memory is evidence about our
parser and no evidence at all about the wire format.

The asynchronous question decides the shape of the connector. Bright Data
answers a large request with a snapshot to poll, which is why `NextPage` has a
`wait` state and why BUG-001 exists. If ScrapeCreators answers at once, the
connector returns `ready` and `done` only, and that is a measured fact worth
writing down rather than a simplification.

The price decides whether the budget guard works at all. `pricePerUnitMicros`
is the guard's only input. It comes from ScrapeCreators' own published price,
read on a recorded date, in whatever unit they actually bill — a request, a
result, a credit. If their unit is not a record, `billableUnit` says so, and
the cost test reports their number and not Bright Data's.

## Acceptance

- [x] A ScrapeCreators provider fetches Reddit through the interface US-024
      settled, and nothing outside `sources/providers/scrapecreators/` names it
- [x] `billableUnit` and `pricePerUnitMicros` come from ScrapeCreators' own
      published price; the ticket Log records the page and the date it was read
- [x] `validateCredentials` refuses a wrong key with the provider's own
      sentence, and answers differently when the provider is unreachable
- [x] The ticket records whether the credential probe was billed, measured
      against `api_usage` and the provider's own figures
- [x] Whether a search answers at once or asynchronously is measured, and
      `next` reports what was measured
- [x] Every call reports `unitsConsumed` in ScrapeCreators' unit, and it is
      never a post count
- [x] Fixtures come from real responses through a committed, re-runnable
      capture script, stored whole with identifying fields scrubbed
- [x] No test reaches ScrapeCreators; the test setup makes the real client
      unreachable
- [x] One live collection stores real Reddit posts and records what it spent;
      the ticket Log holds the record count, the cost and the elapsed time
- [x] A monitor set to Reddit through ScrapeCreators produces at least one
      match in the inbox, and the Log says what the top match was
- [x] The same Reddit post collected through both providers is one row in
      `posts`, asserted by a test
- [x] `posts.source` is still `reddit`; the provider is attribution only

## Notes

- Depends on [US-024](US-024-a-platform-is-separated-from-the-provider-that-fetches-it.md).
- Read [docs/sources.md](../../docs/sources.md) first. The three things
  connectors get wrong are the three this one will get wrong.
- The capture script is the instrument, not a convenience. Commit it beside the
  fixture.
- A live run costs money. Keep the sample small and record the figure, the way
  US-014's cost tests did.
- Do not add a second platform in this ticket. LinkedIn and X are their own
  tickets, and the second platform is where a wrong abstraction shows.

## Log

- 2026-09-05T15:23+08:00 — Written with the provider decision. Scoped to Reddit
  because Reddit is the only path measured end to end.

- 2026-09-05T17:38+08:00 — The price was read from scrapecreators.com, on the
  home page's pricing section: 100 free credits with no card, $47 for 25,000
  credits, $497 for 500,000, and "1 credit === 1 request (for most endpoints)".
  The Reddit search endpoint's own page says 1 credit per request. The
  connector carries 1,880 micro-dollars, which is the $47 pack. The larger pack
  is 994, and the smaller number is the one a new self-hoster pays;
  over-reporting is the safe direction for a guard whose job is to refuse.

- 2026-09-05T17:42+08:00 — `fixtures/capture.mjs` ran against a live account.
  Seven fixtures, four credits, balance 2,095 to 2,091. It answered the five
  questions the ticket asked, and three of the answers are not in the
  documentation:

  * **Synchronous.** A search answered in 1.8 to 4.9 seconds with the posts in
    the body. There is no snapshot and nothing to poll, so `next` is `ready` or
    `done` and never `wait` on a healthy call. That is the opposite of Bright
    Data and it is why the interface carries the state.
  * **The unit is a request**, and the response says so: `credits_charged` is
    on every answer, including the ones charging nothing. One credit bought 7
    posts on a keyword search and 23 on a subreddit, so a unit read from either
    post count would be wrong about the other.
  * **A `timeframe` is refused beside `sort=new`** — "You need to sort by 'top'
    to provide a timeframe". A monitor wants the newest, so the sort is not
    negotiable and `since` is applied by us instead.
  * **A subreddit that does not exist answers 200 with an empty list, and bills
    a credit.** Nothing in the answer says the name was wrong. A misspelled
    subreddit in a monitor therefore costs money every poll and returns
    nothing. `unknown-subreddit.json` is that payload.
  * **A refused key is 401 with `{"success":false,"message":"Invalid API key"}`
    and carries no credits fields at all** — it never reached the account.

  The first run also got two calls wrong, and both were fixed rather than
  explained: it sent a timeframe beside `sort=new`, and it called a
  nonexistent subreddit "input-rejected" when the provider had not rejected
  anything. The script now captures the real refusal and the billed empty
  answer as separate fixtures. `ledger.json` records what every captured call
  did to the balance, because a claim that a check is free is a claim about
  somebody's bill.

- 2026-09-05T17:47+08:00 — The credential probe is free, measured twice. The
  provider's own answer to a search with no `query` is 400 with
  `credits_charged: 0`, and the two live probes through
  `POST /api/connections/scrapecreators/test` wrote no `api_usage` row. A valid
  key was accepted in 1.36 seconds; a wrong one was refused in 0.30 seconds
  with the provider's own sentence repeated back.

- 2026-09-05T17:52+08:00 — Registering a second Reddit connector made
  `registry.only("reddit")` ambiguous, which is the tripwire the registry was
  built with. `only` now reads `defaultProviders`, filled from `REDDIT_PROVIDER`.
  A recorded choice is not a guess: the objection to registration order is that
  nobody chose it. US-026 replaces the variable with a stored choice and a
  settings row; this is the seam it plugs into, and it is the whole mechanism.

  One test went red and the behaviour, not the assertion, is what moved. With
  neither Reddit key set, the resume route now names both providers as
  unblocking the monitor rather than one. The rule underneath is US-024's and
  did not change: a platform is blocked only when every connector for it is.

- 2026-09-05T18:02+08:00 — Live, through the app. A monitor on
  r/softwaretesting collected 47 posts in 2 requests for $0.00376, and **stored
  no new row**: every one of the 47 was already in `posts` from US-022's Bright
  Data collection of the same subreddit. That is the deduplication box measured
  rather than argued — 47 collisions, zero duplicate keys in the whole table.
  It classified to 10 matches.

  A second monitor with no history collected r/QualityAssurance: 48 posts in 2
  requests for $0.00376, all 48 stored and attributed to `scrapecreators`, and
  4 matches at `min_score` 50. The top match scored 69 — a QA lead joining a
  fintech with 0% automation, asking which tools to start with. The classifier's
  fourth reason is the honest one: they are starting before automation exists
  rather than describing a flaky suite.

  Bright Data collected 50 records from a comparable subreddit page for $0.075.
  ScrapeCreators collected 47 and 48 for $0.00376 each. **About twenty times
  less**, and the whole collection took seconds rather than 8 minutes 40.

- 2026-09-05T18:06+08:00 — A repeat poll bills a credit and returns nothing,
  and that is the connector working. `since` is the last poll, the list is
  newest first, so the first page is entirely old and the connector stops
  rather than buying a second page. Three such polls cost 3 credits and stored
  0 posts. US-007's lesson stands with a different unit: poll frequency is a
  cost dial.

  It also means a monitor pointed at a *new* subreddit sees only posts newer
  than its last poll. That is why the live proof needed a second monitor, and
  it may be a product question worth a ticket. It is not this one.

- 2026-09-05T18:08+08:00 — Two stale things were fixed on the way, both left by
  US-024 moving connectors under `providers/`. `biome.json` excluded
  `sources/*/fixtures/*.json`, which no longer matched, so captured payloads
  were being formatted by our tooling again; it is now `sources/**/fixtures/`.
  And both capture scripts resolved the repository root one directory short, so
  neither could read `.env` — the Bright Data one had the same bug and is
  fixed too.

  Still unproven: a real rate limit, a real timeout, and keyword discovery at
  any volume. The 429 branch is our half of a contract the provider has not yet
  shown us. Say so until one has happened.
