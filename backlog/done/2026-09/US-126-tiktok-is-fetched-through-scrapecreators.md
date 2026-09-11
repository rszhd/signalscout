---
id: US-126
title: TikTok is fetched through ScrapeCreators
type: feature
priority: p2
created: 2026-09-11T22:40+08:00
parent:
area:
resolution: shipped
---

## Context

**US-119 measured it and recommends building it: $0.063 for a thousand videos
against SocialCrawl's $0.27.** One search page is one credit at $0.00188 and
returns thirty videos. TikTok then has two providers, which is what the owner
asked for on 2026-09-11.

This is a *provider* for a platform we already fetch, so it is one file beside
`scrapecreators/reddit.ts` and one line in `builtInSources`. It is not a new
platform: `tiktok` already keys `posts.source`, and US-044's rows stay
readable. `scrapecreators` is already in the provider enum and its six check
constraints, so this change needs no migration.

**Deduplication works with no new rule.** Both providers return TikTok's own
numeric video id — `aweme_id` here, `post.id` at SocialCrawl — the way Reddit's
three providers share the `t3_` fullname. A test must assert it with both
providers' fixtures, because it is the claim that stops one video being stored
and billed twice.

**Five measured facts break rules a copy of `reddit.ts` would carry over.**
US-119's Log holds the evidence for each.

*Ask for relevance inside a date window, never for date order.* `sort_by` and
`date_posted` are both real. Sorted by date the page is junk: `flaky tests`
returned dog skin, dandruff and a flaky croissant, because TikTok matches
`flaky` as an ordinary word. Sorted by relevance with no window it returns six
years of posts. `sort_by=relevance` with `date_posted` set to the narrowest
window covering `since` is the request that works, and it is the only one this
connector may build.

*The page is not in date order*, so `reddit.ts`'s third stopping rule — every
post on this page is older than `since`, so stop paging — is wrong here and
must be absent, the same way it is absent from `socialcrawl/linkedin.ts`. The
exact `since` cut is ours.

*A search matching nothing answers `success: true` with thirty unrelated
videos, and is billed.* Nothing in the answer says the query was the problem.
A monitor with a bad query pays this every poll, so the cost test and the
budget guard are what protect a person here, not the connector.

*The share URL carries tracking parameters and must be stripped.*
`?_r=1&u_code=...&source=h5_m` makes the transcript endpoint refuse the same
video, and storing it raw would hold one video under two URLs where SocialCrawl
holds it under one.

*The cursor is a count, `has_more` is a number, and page two may repeat page
one.* Seven of thirty on one run and none on another. A repeated page is billed
in full, so the connector must not treat a repeat as an error, and must not
page further than the budget allows.

**Comments carry an id, a date and a parent, and no reliable permalink.**
`cid`, `create_time` and `aweme_id` were on all eleven captured comments, so
BUG-007's wrong-parent check works here. `share_info.url` held a real comment
link on one capture and an empty string on the next, decided by
`share_info.acl.code`. So the link is built here the way
`socialcrawl/tiktok.ts` already builds it, and `commentLink()` is shared rather
than copied.

**The caption is all the text there is.** The transcript endpoint charges a
credit and returned null on all three videos asked. Do not fetch one per post.

## Acceptance

- [x] A `tiktok` connector on the `scrapecreators` provider is registered, and
      the registry, the monitor form and the connections screen show TikTok as
      fetched by either provider
- [x] The search sends `sort_by=relevance` and the narrowest `date_posted`
      window that covers `since`. A test covers each window boundary, and a
      test pins that `date-posted` ordering is never requested
- [x] The exact `since` cut is made on our side, and paging never stops early
      because a page looks old. A test pins that the rule is absent
- [x] The external id is the numeric video id, so a video collected through one
      provider is not stored again through the other. A test asserts it with
      both providers' fixtures
- [x] A stored post URL has no query string, and a test covers a `share_url`
      that arrives with tracking on it
- [x] A page that repeats videos already collected is not an error, and the
      repeated videos are not stored twice
- [x] `unitsConsumed` is the provider's own `credits_charged`, never a video
      count
- [x] A comment's link is built by the shared `commentLink()`, and a
      `share_info.url` that is present is not preferred over it without a
      measurement saying it should be
- [x] No transcript is fetched
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
      expected value moves

## Notes

- The fixtures, the ledger and every number are in
  [US-119](../done/2026-09/US-119-tiktok-is-measured-at-scrapecreators.md) and
  in `scrapecreators/tiktok-fixtures/`.
- `scrapecreators/client.ts` is written as the Reddit half of one connector:
  `apiBase` ends in `/reddit`. This change makes it the provider's client, the
  way `socialcrawl/client.ts` already is. The base URL moves up one path
  segment, and `verify()` builds its own URL from it.
- The committed fixtures are one whole video and a digest per search page. A
  parser needs a whole page: re-run the capture with the digest turned off for
  one call, and commit that one page, before writing the parser against it.
- Read [docs/sources.md](../../docs/sources.md), *adding a provider*, first.

## Log

- 2026-09-11T22:40+08:00 — Written on US-119's recommendation.

- 2026-09-12T00:05+08:00 — **Built. TikTok has two providers.** 34 tests, and
  the whole suite is 2,053 passing across 117 files.

  **The client became the provider's.** `apiBase` was
  `https://api.scrapecreators.com/v1/reddit`; it is the host now, with the
  platform a segment on each endpoint beside it. `fetchPage` no longer assumes
  Reddit's answer: it takes a `PageShape` saying where the records and the
  cursor are, and the shape is an argument rather than a default so a third
  platform cannot inherit the wrong one by silence. Reddit returns `posts` with
  an `after`, TikTok returns `search_item_list` with a numeric `cursor` beside a
  numeric `has_more`, and YouTube returns `videos` with a `continuationToken`.
  Had `fetchPage` kept its default, TikTok would have parsed as an empty page:
  no error, no posts, one credit.

  **The tests that matter are the ones that pin a measurement**, because every
  one of them is a fact that cost money to learn and would cost money to
  relearn:

  * the search asks for `sort_by=relevance` and never for `date-posted`;
  * the window is the narrowest that covers `since`, at every boundary;
  * the early-stop rule is *absent*, asserted by a page entirely older than
    `since` still handing back a cursor;
  * a stored URL has no query string, and a `share_url` that arrives with
    tracking is cleaned;
  * a page repeating an earlier one is ordinary, not an error;
  * a comment naming another post is dropped, which is BUG-007's rule and is
    live here where it is inert on Instagram;
  * a thread is `partial` whenever a comment claims replies we did not read —
    the captured page's eleven comments claimed 4, 49, 22, 47, 10, 4, 12 and 1
    between them.

  **One captured page was added, for one credit.** The fixtures US-119 left were
  digests plus one whole video, and a parser tested against a digest is a parser
  tested against our own summary. `search-page-whole.json` is a real wire page,
  taken with the narrowest window so that it is complete and 934 KB rather than
  1.8 MB.

  **One test failed and the input was wrong, not the code.** A record stripped
  of `share_url` still parsed, because the parser falls back to
  `share_info.share_url` — which the capture found beside it. The test now
  removes both, and a second test pins the fallback, so the behaviour is
  described rather than discovered again.

  **`commentLink` is imported from the SocialCrawl connector rather than
  copied.** The format belongs to TikTok: US-047 read it off a notification and
  then opened one. Two providers building the same link two ways is how one of
  them gets fixed and the other does not.

  **What is not proven.** No poll has run through this connector. The suite
  covers our half only, and there is no `live:` script for it yet — the rate
  limit, a real provider outage, and what a full poll costs on a real monitor
  are all open.

- 2026-09-12T00:35+08:00 — **Polled live. The collecting half is proven; the
  scoring half is not, and the reason is not this connector.**

  `live:sc-tiktok-poll`, two pages of `flaky tests` with a 24-hour `since`:
  **59 posts collected, 2 credits, 3,760 micro-dollars**, and `api_usage` holds
  one row for the pair priced from `pricePerUnitMicros` rather than from
  anything's assumption. All 59 were new, so `posts` now holds 1,087 TikTok rows
  from SocialCrawl and 59 from here. The connector took 9.1 seconds for both
  pages.

  The pre-filter kept 35 of 59 and dropped 24 on keywords.

  **Then the model did nothing, because the account has no credits left**:
  OpenAI answered "You have no credits remaining" to the embedding call and to
  all 35 classifications. `spentMicros` was 0, so nothing was billed for it.
  The run reported `unclassified: 35` and stopped, which is the right
  behaviour and is the first time it has been seen against a real refusal.

  So what is proven live: the search, the parse, the store, the deduplication
  key, the billing row, and the poll's own accounting. What is still not: a
  score, a match, and what a full poll costs when the model answers. Re-run
  this when the model account has credit.

  What the two figures now say about the two providers on this platform:
  SocialCrawl's 1,087 rows cost about $0.29 at its own price, and these 59 cost
  $0.0038.
