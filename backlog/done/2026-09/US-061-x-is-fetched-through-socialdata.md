---
id: US-061
title: X is fetched through SocialData
type: feature
priority: p2
created: 2026-09-07T17:02+08:00
parent:
area:
resolution: shipped
---

## Context

**US-060 measured it and recommended building it, and the reason is not the
price.** X has had one provider since it had any. Bright Data discovers X by
profile only, ScrapeCreators publishes no X search, and every X poll this
product makes depends on one account at one company. A second provider that
works removes a single point of failure.

**`since_time:` is what makes this better rather than cheaper.** A 24-hour
window returned 7 tweets for $0.0014 where the unwindowed call returned 20 for
$0.0040. `socialcrawl/x.ts` has no window at all: it buys everything older than
`since` and discards it on our side. This connector pushes the window to the
provider, so a poll stops paying for posts it will throw away. Half the price
per post — 200 micro-dollars against 406 — is the smaller half of the case.

**`type=Latest` orders newest first, and that was measured across a whole
page.** So the early-stop rule `socialcrawl/x.ts` already has is legitimate
here too: a page entirely older than `since` means the rest is older still.
This is the first X connector where that rests on a measurement rather than on
a documented claim.

**Four measured facts shape the parser.**

*There is no URL field.* One is built as
`https://x.com/<screen_name>/status/<id_str>`, and US-060 opened one: it lands
on the post. It is also the exact format SocialCrawl returns, so the shape is
not invented — but it is ours to build, which US-047 says is the kind to
re-check whenever the parser changes.

*The id is the bare tweet id.* `id_str` is the same number `socialcrawl/x.ts`
reads out of its own `id`, so `posts` — keyed by `(source, external_id)` with
the provider outside the key — will not store a post twice because a deployment
changed provider.

*An empty search moved the balance not at all.* Recorded as measured-free
rather than promised: the documentation charges for one beyond three requests a
minute, so it may be the free allowance and not a refund.

*The balance is a hard stop.* The API answers **402** when it runs out, which
is not a wrong key and not a rate limit. A person whose account is empty must
be told to top it up, not to replace a working key.

**A migration is required, and forgetting it is a proven failure.** US-057
shipped the Apify connector with `apify` absent from the database's provider
enum: 1,228 tests passed and it could not have stored a single row.
`assertSourcesCanBeStored` checks platforms and nothing checks providers.

## Acceptance

- [x] A migration adds `socialdata` to the provider enum, over every table that
      carries the constraint, and `pnpm db:migrate` applies it
- [x] A `socialdata` provider descriptor exists and the connections screen
      offers it
- [x] An `x` connector on that provider is registered beside the SocialCrawl
      one, and the monitor form still shows one X row
- [x] `since` is sent as `since_time:` inside the query, and a test pins the
      UNIX conversion at a known instant
- [x] The exact cut is still made on our side, because a window is not a
      `since`
- [x] Paging stops early when a whole page falls before `since`, and a test
      pins that the rule is present — the ordering was measured, not assumed
- [x] The external id is the tweet id, and a test asserts it matches what the
      SocialCrawl parser produces for the same post
- [x] The post URL is built from the handle and the id, and a record missing
      either is dropped rather than repaired
- [x] A 402 is its own answer, distinct from a refused key and from a rate
      limit, and its message says to top up the balance
- [x] `unitsConsumed` is the number of tweets returned, because that is what
      this provider bills
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
      expected value moves except X's provider count

## Notes

- The fixtures and every number are in
  [US-060](../done/2026-09/US-060-x-is-measured-at-socialdata.md) and in
  `providers/socialdata/x-fixtures/`.
- **The key can contain a pipe character.** `.env` must quote it, and
  `.env.example` should say so — an unquoted value makes the shell run half the
  key as a command and load nothing.
- `builtInSources` order is what every screen shows. Register beside
  `socialCrawlX`, or X moves up the monitor form. US-055 found that the hard
  way.
- Replies are out of scope. The provider has a comments endpoint and nobody has
  measured what it costs or whether its links work, so `canFetchReplies` is
  false and that is a later ticket.
- `postsPerUnit` is 1: the unit is the tweet, like Bright Data's record and
  Apify's post. `discovery` is `keyword` only.

## Log

- 2026-09-07T17:02+08:00 — Written on US-060's recommendation.

- 2026-09-07T17:35+08:00 — Built and closed. **1,297 tests pass**, lint and
  typecheck clean, and the only expected value that moved is X's provider
  count, from one to two.

  A provider descriptor, a client, a connector and 30 tests driven against
  US-060's fixtures. Migration 0040 adds `socialdata` to the provider enum over
  the seven tables that carry the constraint — **written first this time**,
  because US-057 shipped a connector that passed 1,228 tests and could not have
  stored a row.

  Three things in this connector exist nowhere else in the product.

  **The window is sent, not simulated.** `since` becomes `since_time:` inside
  the query, floored to the second — rounding up would ask for posts *after*
  `since` and lose anything written in the second between. The exact cut is
  still made here afterwards, because a window sent to a provider is a request
  and not a guarantee, and BUG-002 is what trusting one looks like.

  **The early stop is legitimate.** `type=Latest` was measured to order newest
  first across a whole page, so a page entirely older than `since` means the
  rest is older still. On a per-tweet provider that page is not a wasted
  request — it is a wasted twenty.

  **The balance is its own error kind.** A 402 is neither a wrong key nor a
  rate limit, and `validateCredentials` probes the free balance endpoint rather
  than a search: a person whose account is empty has a perfectly good key, and
  a probe that searched would send them to look at the one thing that is fine.

  Two corrections the build made. The synthetic record in the deduplication
  test did not match SocialCrawl's wire format — that provider wraps its post
  in `{ post: … }` — so the test failed on a shape difference rather than on
  the ids, which are identical. And `.env.example` now says to quote the key,
  because a pipe inside it makes a shell load nothing.

  **Nothing has polled live through this connector.** The parser, the cursor,
  the window, the early stop and the refusals are all driven from captured
  payloads. A real poll, a real rate limit, a real 402 and a second poll
  proving deduplication are all unproven.

- 2026-09-07T17:58+08:00 — **One live poll has run, and it proved the thing
  this connector exists for.**

  A monitor with the query `flaky tests` and a 24-hour `since` collected **7
  posts in 2 pages for 7 units, $0.0014**. Two pages without a window would be
  forty tweets and $0.0080, so **the window cut the bill by 82%** — measured
  through the worker rather than in a capture script.

  It held on the way in too. The seven posts run from 19.8 hours old to 87
  minutes; SocialCrawl's forty, collected earlier without a window, run to 4.8
  days. Nothing outside the window arrived and nothing outside it was paid for.

  **The recorded cost equals the provider's own balance movement, exactly.**
  `api_usage` holds 1,400 micro-dollars and the account went $0.0718 to
  $0.0704, which is $0.0014. That is the second time a figure in this table has
  been checked against a provider's own number, and the first time it matched
  to the micro-dollar — Bright Data's day was 3.2% high.

  **Zero matches, and that is an honest outcome rather than a fault.** The
  pre-filter dropped one of seven on keywords and the classifier read six for
  $0.0217, finding nothing at or above 50. Six posts mentioning flaky tests in
  one day on X is a thin sample of a narrow query; it says nothing about the
  connector, which returned exactly what was asked for.

  `live:x-poll` is the script. `live-linkedin-poll.ts` became `live-poll.ts`
  and takes `--platform=`, because everything in it except the platform id was
  already general. The platform must be named — a live poll spends money, and a
  default would let a mistyped flag bill the wrong account. `--since-hours=`
  defaults to 24 so a connector's window is exercised; a monitor created fresh
  has never polled, so without it `since` is undefined and the window is never
  sent.

  Still unproven: a real rate limit, a real 402, and a second poll proving
  deduplication on X.

- 2026-09-07T18:22+08:00 — **Deduplication is proven on X, and a rate limit is
  still not.**

  A second poll of the same query with the same 24-hour window collected **8
  posts, billed 8 units and $0.0016, and stored 1 new**. Seven of the eight
  were already held and were not stored again. The one new row is a tweet
  written in the twenty-four minutes between the two runs, which is the
  connector working rather than failing.

  **The cost matched the provider's balance exactly for the second time**:
  `api_usage` holds 1,600 micro-dollars and the account moved $0.066 to
  $0.0644. Two polls, two exact matches.

  **The rate limit was not provoked.** Twenty-five searches fired back to back
  all answered 200. So the limit is above that rate and the 429 branch remains
  our half of a contract the provider has not shown us. That is the same state
  every connector in this repository is in, and it is worth saying that trying
  and failing to trigger one is not evidence there is none.

  The attempt cost $0.0044 and corrected a finding in
  [US-060](US-060-x-is-measured-at-socialdata.md): an empty search is free only
  inside the three-requests-a-minute allowance, and costs $0.0002 outside it.

  Still unproven: a real rate limit, and a real 402. The 402 is not worth
  forcing — it costs the whole balance — so it should be captured when the
  account runs out on its own.
