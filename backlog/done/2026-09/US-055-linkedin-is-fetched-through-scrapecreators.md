---
id: US-055
title: LinkedIn is fetched through ScrapeCreators
type: feature
priority: p2
created: 2026-09-07T14:02+08:00
parent:
area:
resolution: dropped
---

## Context

**US-054 measured it and recommended building it: $0.0094 for fifty posts
against SocialCrawl's $0.2030.** Ten posts for one credit, twenty-two times
cheaper, and the freshness risk closed — `date_posted=last-week` returned a
full page inside the window with the newest post one day old.

This is a *provider* for a platform we already fetch, so it is one file beside
`scrapecreators/reddit.ts` and one line in `builtInSources`. It is not a new
platform: `linkedin` already keys `posts.source`, and US-028's rows stay
readable.

**Deduplication across the two providers should work, and the reason is the
activity id.** SocialCrawl returns `id: "7500190661334249473"`; ScrapeCreators
returns no id at all, and puts the same number inside the post URL as
`...-activity-7500106623722475520-u_64`. Pulling that number out gives one
identifier space, which is exactly what Reddit's `t3_` fullname does for its
three providers. **This provider has no id field**, so the URL is the only
identity there is, and a record whose URL carries no activity id cannot be
stored.

**Four measured facts break rules a copy of `reddit.ts` would carry over.**

*An empty search answers 404 and costs nothing.* `{"success": false, "error":
"not_found", "message": "No posts found"}`, `credits_charged: 0`. The shared
client turns any non-200 into a thrown error, so a query that simply found
nothing would fail the poll. It is an empty page, not a failure.

*The answer is ordered by relevance, not by date.* An unfiltered page ran 4
April 2025 to 4 September 2026 in no order. So `reddit.ts`'s third stopping
rule — every post on this page is older than `since`, so stop paging — is wrong
here and must be absent, for the same reason it is absent from
`socialcrawl/linkedin.ts`.

*The window is a parameter with five values*: `last-hour`, `last-day`,
`last-week`, `last-month`, `last-year`. Ask for the narrowest that still covers
`since` and make the exact cut ourselves. Two more values than SocialCrawl
offers for the same platform.

*The cursor is a page number.* The answer returns `cursor: "2"`, and the
documentation stops it at 11 — about 120 posts a query. Page two shared none of
page one's ten.

**The comments are the interesting part and they cannot be used yet.** They
arrive free inside the search page — 72 across 30 posts, a median of 177
characters, far more substantial than Instagram's 26 — but each one carries
only `author`, `text` and `linkedinUrl`, which is the commenter's profile. No
id, no date, no permalink. A reply this product stores needs a timestamp it
does not have and a link US-047 requires. So `canFetchReplies` is false and the
reason is written down, rather than the field being left to look like an
oversight.

**It is slow.** 9.2 to 11.4 seconds a call, against 1.8 to 4.9 for this
provider's Reddit endpoints, because it searches Google and then scrapes each
page it finds.

**LinkedIn will have two providers when this lands**, so `decideProvider` will
demand a recorded choice from any deployment holding both keys. That is US-026
working, not a regression, and the connections screen is where the choice is
made.

## Acceptance

- [ ] A `linkedin` connector on the `scrapecreators` provider is registered,
      and the registry, the monitor form and the connections screen show
      LinkedIn as fetched by either provider
- [ ] The parser is written against the committed fixtures, and a record with
      no activity id in its URL is dropped rather than repaired
- [ ] The external id is the activity id, so a post collected through one
      provider is not stored again through the other. A test asserts it with
      both providers' fixtures for the same post shape
- [ ] A 404 "No posts found" is an empty page that charges nothing, not a
      failed poll
- [ ] `since` selects the narrowest of the five windows that covers it, and
      the exact cut is made on our side. A test covers each window boundary
- [ ] Paging never stops early because a page looks old: the ordering is
      relevance, and a test pins that the rule is absent
- [ ] `unitsConsumed` is the provider's own `credits_charged`, never a post
      count
- [ ] `canFetchReplies` is false, and the monitor form says so for this
      connector
- [ ] Channels are not searched, and a monitor naming one is not silently told
      it was
- [ ] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
      expected value moves

## Notes

- The fixtures and the numbers are in
  [US-054](../done/2026-09/US-054-linkedin-is-measured-at-the-other-provider.md)
  and in `scrapecreators/linkedin-fixtures/`.
- `scrapecreators/client.ts` is written as the Reddit half of one connector and
  has to become the provider's client, the way `socialcrawl/client.ts` already
  is. That means the base URL moves up one path segment. Check `verify()`,
  which builds its own URL from it.
- Read `docs/sources.md`, *adding a provider*, first.
- Do not copy `reddit.ts`'s stopping rules wholesale. Three of them are right
  and one is wrong here, and the wrong one loses fresh posts silently.
- [US-053](US-053-a-connector-ships-without-being-offered.md) comes after this,
  not before. Switching SocialCrawl off first would leave no LinkedIn at all in
  between.
- The comments question is worth its own ticket once this lands: whether a
  hundred of them classify into leads, and whether anything can be done about
  a comment with no permalink.

## Log

- 2026-09-07T14:02+08:00 — Written on US-054's recommendation, at the owner's
  request.

- 2026-09-07T13:36+08:00 — **Dropped, built and passing, on the owner's
  decision.** The connector was written, its 34 tests passed and the whole
  suite was green. The reason it is not shipping is the route: this endpoint
  finds posts through Google's index and then scrapes them, and the owner is
  not willing to depend on that.

  **The measurement did not answer that objection, and it is worth being clear
  why.** US-054 measured that a one-day-old post *was* findable, which is
  freshness. Coverage is a different question — how many posts matching a query
  Google's index never held — and nothing in the capture tests it. A middleman
  that silently drops posts fails in a way no poll would ever notice.

  The work is not deleted. It is in a named stash,
  `US-055 ScrapeCreators LinkedIn connector, dropped: coverage depends on
  Google's index`, and it is rebuildable from this ticket in any case. Three
  pieces of it are worth keeping if LinkedIn is ever fetched this way again:
  the activity id read out of the post URL, which is the only identity that
  provider gives and the one that deduplicates against SocialCrawl; the 404
  `not_found` that means an empty page rather than a failure; and the five
  `last-*` windows.

  One thing it found that outlives it: **`builtInSources` order is the order
  every screen shows platforms in**, because `groupByPlatform` keeps
  registration order. Registering the new connector next to its provider's
  sibling moved LinkedIn ahead of X on the monitor form. A new connector goes
  beside the others for its platform.

  [US-056](../../todo/US-056-linkedin-is-measured-at-apify.md) replaces it.
