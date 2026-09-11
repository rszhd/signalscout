---
id: US-126
title: TikTok is fetched through ScrapeCreators
type: feature
priority: p2
created: 2026-09-11T22:40+08:00
parent:
area:
resolution:
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

- [ ] A `tiktok` connector on the `scrapecreators` provider is registered, and
      the registry, the monitor form and the connections screen show TikTok as
      fetched by either provider
- [ ] The search sends `sort_by=relevance` and the narrowest `date_posted`
      window that covers `since`. A test covers each window boundary, and a
      test pins that `date-posted` ordering is never requested
- [ ] The exact `since` cut is made on our side, and paging never stops early
      because a page looks old. A test pins that the rule is absent
- [ ] The external id is the numeric video id, so a video collected through one
      provider is not stored again through the other. A test asserts it with
      both providers' fixtures
- [ ] A stored post URL has no query string, and a test covers a `share_url`
      that arrives with tracking on it
- [ ] A page that repeats videos already collected is not an error, and the
      repeated videos are not stored twice
- [ ] `unitsConsumed` is the provider's own `credits_charged`, never a video
      count
- [ ] A comment's link is built by the shared `commentLink()`, and a
      `share_info.url` that is present is not preferred over it without a
      measurement saying it should be
- [ ] No transcript is fetched
- [ ] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
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
