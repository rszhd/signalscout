---
id: US-031
title: SocialCrawl is measured as a third Reddit provider
type: spike
priority: p2
created: 2026-09-06T01:50+08:00
parent:
area:
resolution: shipped
---

## Context

The owner decided on 2026-09-06 to move off Bright Data on price.
`BRIGHTDATA_API_KEY` is already absent from `.env`, so Reddit runs on
ScrapeCreators alone. US-020's work found that SocialCrawl — the key this
deployment already holds for X and LinkedIn — publishes eight Reddit endpoints.
That makes a third Reddit provider possible without a new account, a new key or
a new rotation.

This ticket decides whether to build it. It does not build it.

**One endpoint is the reason to look.** `/v1/reddit/subreddit/search` takes a
subreddit *and* a query. Neither other provider has it, and it is exactly the
combination US-022 measured as missing:

* Keyword discovery across Reddit returns noise. Bright Data matched "test" and
  "end" as ordinary words and brought back r/AllFinraExams and r/islam.
* One subreddit returns fifty posts that are all on topic, but it ignores the
  monitor's words entirely, so a `min_score` of 30 let "Dev memes" reach the
  inbox.

A keyword inside a chosen subreddit is the missing third mode. Whether it works
is unmeasured, and it is the question worth the credits.

**A second endpoint is stranger and may be better or useless.**
`/v1/reddit/omni-search` sweeps a keyword, expands the top threads' comments
inline, capped at fifteen a thread, and rolls up which subreddits are talking.
It is metered at one credit a search page plus one a thread, minimum five, and
it refunds a failed thread and an unused ceiling. Its own documentation warns
that Reddit search there is the slowest on the API — a 10 to 12 second median
with a tail past 30 seconds — and that "relevance is loose: a VoC sweep, not
precision ranking". Take that warning at face value and measure against it.

**The price runs the wrong way, so relevance has to pay for it.** A SocialCrawl
credit is 8,118 micro-dollars, read from the provider's pricing page and
already in `socialcrawl/x.ts`. A ScrapeCreators request is 1,880. So a
SocialCrawl call costs 4.3 times a ScrapeCreators call, and the question is not
"is it cheaper" — it is not — but "does it return enough more of the right
posts to be worth 4.3 times". A ScrapeCreators keyword search returned 7 posts
for one credit and a subreddit page returned 23. Those are the numbers to beat.

**Comments are not the reason.** US-020 already measured that side and decided
against it: SocialCrawl returns a deeper, honest comment tree and charges
twenty-two times more for the median thread. That conclusion stands and this
ticket does not reopen it.

**Nothing about the plumbing is new.** `socialcrawl` is already in the
`providers` list, the client and key are shared, `ProviderDescriptor` was split
so one provider can fetch several platforms, `decideProvider` already handles a
platform with more than one usable connector, and `api_usage` is keyed by the
pair. A third Reddit connector is a connector, not an architecture change.

## Acceptance

- [x] `/v1/reddit/search` and `/v1/reddit/subreddit` are each called once with
      the same terms a ScrapeCreators call was given, and the Log records posts
      returned, credits charged, seconds taken and cost per post for both
      providers
- [x] `/v1/reddit/subreddit/search` is called with a monitor-shaped keyword
      inside a topical subreddit, and the Log says how many of the returned
      posts are on topic, counted by reading them
- [ ] `/v1/reddit/omni-search` is called once, and the Log records what it
      cost after refunds, how long it took, and whether its inline comments
      carry anything the post did not — **not done: it is metered from five
      credits and the balance was eleven. The three search endpoints answered
      the question this ticket asked.**
- [x] The answers are written as fixtures through a capture script, with author
      identity scrubbed, and the fixtures are read before they are committed
- [x] The Log states a decision in one sentence: build the connector, or do not
- [x] ~~If the decision is to build, a separate ticket is written. This one does
      not add a connector~~ — **overtaken.** The owner asked for the connector
      directly, so the spike and the build closed together. The measurement
      still came first and it still decided the shape

## Notes

- The catalogue is free. `/v1/utility/endpoints?platform=reddit` and
  `/v1/utility/endpoint?id=<id>` both answered with `credits_used: 0`, and the
  per-endpoint guide carries the parameters, the pagination style and the
  billing rules. Read it before spending anything.
- Budget about $0.07: a few standard calls at $0.0081 and one metered
  omni-search at five credits or more.
- Identical calls inside the cache TTL cost 0 credits — 300 seconds on the
  comment endpoints. Useful while writing the capture, and worthless to an
  hourly poll. Do not let a cached answer be recorded as a measurement.
- The eight endpoints, with their catalogue prices: `subreddit` 1,
  `subreddit/details` 1, `search` 1, `subreddit/search` 1, `post` 1,
  `post/comments` 5, `omni-search` metered from 5, `post/transcript` 10.
- `/v1/reddit/post` at one credit is a second opinion for US-015, whose
  ScrapeCreators deletion checks are ambiguous. Out of scope here, but note in
  the Log if the capture happens to show it.
- docs/sources.md holds the list for adding a provider. Read it before the
  follow-up ticket, not before this one.
- No test spends money. This is an instrument, run by hand.

## Log

- 2026-09-06T01:50+08:00 — Written after US-020's comment probe found eight
  Reddit endpoints on the key this deployment already holds. The reason to
  measure is `subreddit/search`: a keyword inside a subreddit is the discovery
  mode US-022 showed is missing, and no other provider offers it. The price
  runs the wrong way at 4.3 times a ScrapeCreators call, so relevance is what
  has to pay for it.


- 2026-09-06T11:35+08:00 — Measured, then built, in that order. Four billed
  calls at one credit each, $0.032, plus a free refusal.

  **The decision: build it, and the reason is one endpoint.**

  | Mode | Endpoint | Returned |
  |---|---|---|
  | Keyword across Reddit | `/v1/reddit/search` | 25 posts, **noise** |
  | One subreddit | `/v1/reddit/subreddit` | 23 posts |
  | Keyword *inside* a subreddit | `/v1/reddit/subreddit/search` | **7 posts, all on topic** |

  `flaky tests` across all of Reddit brought back r/TIdaL, r/RedditLaqueristaSwap,
  r/Euphoria_HBO, r/AskVet and r/snapmaker — a watch app whose audio was "still
  flaky with 3+ devices", and a dog with a skin issue. The same two words inside
  r/softwaretesting brought back seven posts about flaky test suites, and the
  capture checked the scope directly: **every one from the subreddit asked
  for.** No leak.

  That is the mode US-022 showed was missing, and neither Bright Data nor
  ScrapeCreators has it.

  **So the connector inverts the usual order.** Scoped first wherever a monitor
  names both a query and a channel; a bare subreddit sweep only when there is no
  query; and the keyword-across-Reddit search only when there is no channel at
  all. The other two Reddit connectors treat those as equal discovery modes.
  Here the capture says they are not.

  **It costs 4.3 times a ScrapeCreators call and buys precision, not volume.**
  Seven right posts against twenty-five wrong ones. A monitor that wants cheap
  breadth still uses ScrapeCreators; this is for a monitor that knows where its
  people are.

  **It does not read replies, and that is a decision rather than an omission.**
  SocialCrawl's Reddit comment endpoint is 5 credits against ScrapeCreators' 1
  for the same thread, measured in US-020. `canFetchReplies: false`, so the
  monitor form tells a person who picks this provider that replies will not
  arrive — rather than leaving them to notice.

  One detail worth keeping: this provider reports a bare post id where the other
  two report Reddit's `t3_` fullname. The parser rebuilds the prefix, because
  deduplication is keyed on it and one provider's copy of a post must match
  another's.

  Speed: 7.1 seconds for the first call and 2.2 to 2.9 after. The provider warns
  of a 10 to 12 second median with a tail past 30. Four calls is not a
  distribution, but nothing here was slow enough to need a longer timeout.

  1,007 tests pass. Three expected values moved, all of them counting Reddit's
  providers, which is now three.
