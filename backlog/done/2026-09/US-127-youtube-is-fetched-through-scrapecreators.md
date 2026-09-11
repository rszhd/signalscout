---
id: US-127
title: YouTube is fetched through ScrapeCreators
type: feature
priority: p2
created: 2026-09-11T23:30+08:00
parent:
area:
resolution: shipped
---

## Context

**US-121 measured it and recommends building it, and the price is not the
argument.** One search page is one credit at $0.00188 for twenty videos, so
$0.094 for a thousand against SocialCrawl's $0.180. Twice as cheap is thin.

**The argument is text.** `socialcrawl/youtube.ts` gives the classifier a
title, 68 characters at the median, which is the thinnest text of any platform
here. This provider returns a description on every video — 1,413 to 1,620
characters at the median — for the same one credit, and a transcript for one
credit more, measured at 8,634 and 31,971 characters on two videos. A YouTube
match scored through this provider is scored on twenty times the text.

YouTube then has two providers, which is what the owner asked for on
2026-09-11. `youtube` already keys `posts.source` and `scrapecreators` is
already in the provider enum, so this change needs no migration.

**Deduplication works with nothing done to it.** Both providers return the
eleven-character video id and the same `watch?v=` URL. TikTok needed a URL
stripped first; this does not.

**`includeExtras=true` is mandatory, and the second reason is the one that
breaks a poll.** `publishedTime` is an ISO timestamp that the provider computes
by subtracting "3 weeks ago" from the moment of the call — every video in one
answer carries the same time of day. `publishDate` is the real one and arrives
only with the extras. A `since` cut made on `publishedTime` is wrong by up to a
day, every poll, and nothing in the answer says so.

**Three more measured facts shape the connector.**

*There is no date order and no way to ask for one.* `sortBy` takes `relevance`
and `popular`. So the early-stop rule `reddit.ts` uses must be absent, as it is
on LinkedIn, and the exact cut is ours. Relevance is a good ranking here: the
first page was on topic with no window at all, unlike TikTok.

*`uploadDate` narrows and leaks.* `today` returned twelve videos, nine of them
hours old and three of them weeks old. Send it — it is the difference between
twelve results and twenty — and never trust it as the filter.

*Nothing is mixed in.* The answer is one array per kind. `type=videos` is still
worth sending, because a short is not a conversation.

**Comments are probably not worth fetching on this platform.** One video in
twenty had a single comment, and it was "nice video sir". A comment carries an
id, an author and no permalink, and its date is derived from relative text with
no extras flag to correct it. Ship `canFetchReplies: false` unless a
measurement on a different keyword says otherwise, and write the reason down
rather than leaving the field looking like an oversight.

**The transcript is the open question this ticket should answer.** It costs one
credit a video, which doubles the price of a collected post, and it is by far
the most text this product has ever had to classify. Whether it makes a better
match is not known, and buying one for every video before knowing is how a poll
spends its cap on nothing.

## Acceptance

- [x] A `youtube` connector on the `scrapecreators` provider is registered, and
      the registry, the monitor form and the connections screen show YouTube as
      fetched by either provider
- [x] Every search sends `includeExtras=true` and `type=videos`, and a test
      pins both. A test asserts that the stored timestamp comes from
      `publishDate` and never from `publishedTime`
- [x] The exact `since` cut is made on our side, against `publishDate`, and
      paging never stops early because a page looks old. A test pins that the
      rule is absent
- [x] `uploadDate` is sent as the narrowest value covering `since`, and a test
      covers a video outside the window arriving inside the answer
- [x] The external id is the eleven-character video id, so a video collected
      through one provider is not stored again through the other. A test
      asserts it with both providers' fixtures
- [x] The classified text is the title and the description together, and a test
      covers a video whose description is empty
- [x] `unitsConsumed` is the provider's own `credits_charged`, never a video
      count
- [x] `canFetchReplies` is false, with the reason written on the connector, or
      a measurement in this ticket's Log says why it should be true
- [x] No transcript is fetched by the connector. If this ticket decides it
      should be, the price is declared separately, the way
      `replyPricePerUnitMicros` already is
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and no existing
      expected value moves

## Notes

- The fixtures, the ledger and every number are in
  [US-121](../done/2026-09/US-121-youtube-is-measured-at-scrapecreators.md) and
  in `scrapecreators/youtube-fixtures/`.
- `scrapecreators/client.ts` still ends its base URL in `/reddit`.
  [US-126](US-126-tiktok-is-fetched-through-scrapecreators.md) moves it up a
  segment; whichever of the two lands first does that work.
- Read [docs/sources.md](../../docs/sources.md), *adding a provider*, first.

## Log

- 2026-09-11T23:30+08:00 — Written on US-121's recommendation.

- 2026-09-12T00:05+08:00 — **Built. YouTube has two providers.** 28 tests, and
  the whole suite is 2,053 passing across 117 files.

  The client work is US-126's and landed with it.

  **`includeExtras=true` and `type=videos` are sent on every search**, and a
  test pins both. The extras are what make this connector worth having: the
  stored text is the title and the description together, and the test asserts
  the median stored text is over 500 characters where the median title is under
  200.

  **The date test is the one to keep.** It reads the fixture rather than the
  code: twenty videos carry one or two distinct times of day in `publishedTime`
  and many more in `publishDate`, which is the evidence that the first is
  arithmetic on "3 weeks ago" and the second is real. If that ever stops being
  true, the reason for the extras has changed and this test says so.

  **An approximate date survives the `since` cut.** When `publishDate` is
  missing — which means the extras did not reach the call —
  `postedAtIsApproximate` is set and the post is kept. US-034 settled the
  direction: dropping a video because the provider was vague loses a lead
  nobody can tell was lost, and keeping it costs one model call.

  **`canFetchReplies` is false, and the reason is written on the connector.**
  US-121 measured one comment across twenty videos and it was "nice video sir";
  a comment here also has no permalink, no parent id, and a date derived from
  relative text that no parameter corrects.
  `socialcrawl/youtube.ts` fetches comments and stays the choice for a monitor
  that wants them.

  **No transcript is fetched**, though the endpoint works and is the largest
  body of text this product could reach — 31,971 characters on one video. It
  doubles the price of a collected post, and whether it makes a better match is
  unmeasured. That is a ticket, not a default.

  **What is not proven.** No poll has run through this connector.
