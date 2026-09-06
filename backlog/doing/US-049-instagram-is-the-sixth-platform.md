---
id: US-049
title: Instagram is the sixth platform
type: feature
priority: p2
created: 2026-09-06T17:05+08:00
parent: US-038
area:
resolution:
---

## Context

**PLAN.md said not to, and this is the fourth time.** The rule at PLAN.md's
*Important rule* is that no further network is added until Reddit and X reliably
produce useful matches, and that condition is unmet in the same words it has
been all day: **five verdicts exist and the rest of the matches sit unjudged**.
LinkedIn crossed the rule in US-028, YouTube in US-034 and TikTok in US-044.
This is the fourth crossing and the owner made it. It is written here, in
STACK.md and in AGENTS.md so the next reader finds a decision rather than an
oversight, and the rule still stands for the seventh.

It is split out of [US-038](../parked/US-038-instagram-tiktok-and-threads.md),
which parked three platforms together and said that when they were unparked they
should be split, because US-028 and US-034 both found that one provider does not
mean one contract. TikTok was the first split out. This is the second, and
Threads is still parked.

**The free catalogue was read before anything was paid for**, on
2026-09-06, through the provider's own `/v1/utility/endpoint` surface. Five
facts came out of it and each one shapes the connector.

**Search is cheap and comments are dear, which inverts TikTok.**
`/v1/instagram/search/reels` is **1 credit**. `/v1/instagram/post/comments` is
**5 credits** — five times TikTok's and YouTube's comment page, and the same
price as a whole LinkedIn search. On this provider a credit is 8,118
micro-dollars, so an Instagram comment page is about **$0.041** against TikTok's
$0.0081.

That number is the whole product question for this platform. US-034 and US-044
both measured that a video search returns publishers rather than people and the
lead is in the comments underneath. If that holds here, then Instagram's leads
live behind its expensive endpoint and its cheap one is the part that does not
carry them. US-044 read 60 TikTok comments for $0.198 and found seven matches;
the same 60 comments here would cost about $1.02 in provider credit before a
single model call.

**Search pages by number, not by cursor.** The catalogue calls the paging style
`page` and maps the universal `cursor` alias onto a page integer. Every other
connector in this repository follows an opaque string. Nothing downstream cares
— a cursor is opaque to the caller by design — but the connector must not assume
the string it gets back is a token.

**The result order is relevance, and the catalogue says it is not stable
between calls.** In its own words: the same query re-run minutes later can
return a different, overlapping set, and results should be deduplicated by post
id across pages. So X's "the whole page is older than `since`, stop paging" rule
is wrong here for the second time — LinkedIn was the first — and must be
deliberately absent rather than copied.

**There is a date window, and it is LinkedIn's shape with finer steps.**
`date_posted` takes `last-hour`, `last-day`, `last-week`, `last-month` or
`last-year` and nothing between them, so the connector asks for the narrowest
window covering `since` and makes the exact cut itself. One warning comes with
it: the catalogue says a filtered search is served by a different upstream
surface, one that no longer carries play counts. We read no play count, but a
different surface may differ in more than the field it drops, and that is a
capture question rather than an assumption.

**A third discovery mode exists and is not one.** `/v1/instagram/search/profiles`
is 1 credit but it is a Google-backed profile search returning accounts, and a
monitor exists to find a stranger describing a problem, not to name an account.
`/v1/instagram/search/hashtag` is 5 credits and is a real second mode; whether it
is worth five times the reel search is a measurement nobody has taken.

**What nobody knows.** No call has been made to either endpoint. Whether an
Instagram comment carries the length TikTok's skincare comments carried is
unmeasured, and it is the thing that decides whether this platform is worth
polling at five credits a page.

## Acceptance

- [x] `instagram` is a platform in `db/schema.ts` and in a migration, and its
      `PlatformDescriptor` carries its own query rule and a note saying where
      the lead is and what it costs to read
- [x] Fixtures are captured from a live account by a script under the
      connector's own directory, with author identity scrubbed, and are read
      before they are committed
- [ ] The Log says what the reel search and the hashtag search each returned,
      and which one this connector uses, with the reason
      — **half open.** The run was lean and never called the hashtag search.
      The reel search is used, and the reason it is used is written; the reason
      the other is *not* is still a price argument rather than a measurement.
- [x] The connector searches by keyword and pages, and a test replays a
      captured answer
- [x] `since` is applied from a date the provider stands behind, and the Log
      says whether it publishes one
- [x] The relevance ordering is handled explicitly: no page is treated as the
      end of a query because its posts are old
- [x] The connector reads comments through `fetchReplies`, declares
      `canFetchReplies`, and stores them as `kind = 'reply'` rows under their
      post, through the shared parser
- [x] The comment endpoint's `sort` is chosen from evidence, not from the
      default — `recent` arrived strictly newest-first where `top` did not.
      The catalogue's separate claim, that a `top` walk repeats past the ranked
      head, was not tested: that was the other call the lean run dropped.
- [x] `ReplyResult.partial` is reported from evidence, the same rule the other
      four connectors follow
- [x] The reply price is declared separately from the search price, because
      they are 5 credits and 1 and a guard fed the wrong one lets a monitor
      spend five times its cap
- [x] The Log records what one search and one comment page cost and returned,
      measured
- [ ] **Somebody opens one comment link.** US-047's rule: a URL format we build
      is evidence about our own string building and none about the platform.
      This one is read off the provider's own `comment` endpoint rather than
      invented, which is a better source and not a proof.
- [x] **One live poll runs through the worker**, the way `live:tiktok-poll`
      proved TikTok. `live:instagram-poll` collected 20 reels and 89 comments,
      and `live:instagram-comments` then read the comments it had bought. Five
      comment matches, the best at 90.

## Notes

- The 5-credit comment page is the same trap US-028 found on LinkedIn: at five
  to one, "a request" and "a credit" are different numbers, and
  `replyPricePerUnitMicros` exists for exactly this.
- Expect the TikTok finding to decide this platform rather than any code here.
  A monitor whose customers must describe a condition to get a useful answer
  found people under a skincare video. One selling to engineers did not.
- Threads stays parked. It is the strongest of US-038's three on paper and it
  is still behind the same gate.

## Log

- 2026-09-06T17:05+08:00 — Split out of US-038 at the owner's request, and the
  free catalogue read before anything was paid for. Five facts recorded above,
  all free, and the one that matters is the price: search 1 credit, comments 5.

- 2026-09-06T17:40+08:00 — Captured live, lean, for **13 credits** ($0.106).
  Seven calls: two reel searches, a second page, a date-filtered search, two
  comment pages and one free refusal. The hashtag search and the second `top`
  comment page were dropped by `--lean` and their questions stay open.

  **What one call costs and returns.** A reel search: 1 credit, 30 reels, 6.0
  to 6.7 seconds. A date-filtered reel search: 1 credit, 8 reels, **20.4
  seconds** — three times slower, which is the different upstream surface the
  catalogue warned about. A comment page: 5 credits, 15 comments on `top` and
  14 on `recent`, 1.7 to 2.3 seconds, on a thread the provider said held 71. The
  refused key was free and said `Invalid API key format. Keys start with 'sc_'.`

  **The finding that shaped the connector: a search with no date window returns
  five years.** Thirty results for `skincare for acne scars` ran from
  2021-12-25 to 2026-04-08, in relevance order — 2023, 2026, 2024, 2025, 2023 —
  and **the newest of the thirty was five months old**. A monitor asking what
  was said since it last looked would be billed a credit a poll and handed
  nothing that passed its `since`, for as long as it ran. The same query with
  `date_posted=last-month` returned eight reels, **all eight inside the
  window**. So this connector always sends a window and `last-year` is the
  floor. `linkedin.ts` sends none in the same case; copying it here would have
  been the silent failure.

  **`has_more` is wrong.** Page one came back with 30 reels, `has_more: true`
  and a cursor. That cursor returned **zero items, `page_size: 0`, zero
  credits, and another `has_more: true` with another cursor**. The walk
  therefore ends on an empty page. That is not the same as reading an empty
  answer as a finished query, which US-006 measured wrong on X — nothing is
  remembered, and the next poll starts at page one.

  **The date is exact and the provider stands behind it.** Every reel carried an
  ISO `published_at` to the second, with `ext.published_at_epoch` beside it on
  the unfiltered surface. No derived-date drift like US-034 found on YouTube.

  **`sort=recent` is used, measured rather than assumed.** The `recent` page
  arrived strictly newest-first — 09-30, 09-30, 09-29, 09-29, 09-29, 09-29,
  09-28 and down. The `top` page did not: 09-28, 09-29, 09-27, 09-30, 09-30.
  US-048's finding adds the product reason — leads sit deeper than an
  engagement ranking puts them, because a question collects no likes.

  **Three of nine comment fields are null on every comment**: `url`, `post_id`
  and `author.display_name`, over 29 comments, against 137 from X, YouTube and
  TikTok that fill all three. So `comments.ts` now falls back to `username` for
  a name — which changes nothing on the other three, checked — and **BUG-007's
  wrong-parent check is inert here**, because there is no `post_id` to
  disagree with. That is written in the parser rather than left to be found.

  **The measurement that decides whether to tick this box: the comments are
  short.** Median **26 characters, and none of 29 over sixty**, on a skincare
  reel — the exact category US-044 found working on TikTok, where the same kind
  of thread ran a median of 54 with 22 of 49 over sixty. Half the words, at five
  times the price per page. One thread each is not a distribution, and it is
  enough to say in `platforms.ts` that a person should expect a higher cost per
  lead here than on either video platform beside it.

  The suite is 1,114 passing. Five assertions moved, all in
  `apps/api/src/monitors.test.ts`, all the same kind: they enumerate every
  platform, and a sixth platform adds a sixth key. That is the behaviour US-027
  built and the change US-044 made for TikTok.

- 2026-09-06T18:20+08:00 — **The live poll ran, and the budget guard refused a
  real poll for the first time in this repository.** `live:instagram-poll`
  collected 20 reels and 89 comments under a $1.00 cap. Both paid stages then
  refused: `classify` stopped with 89 items unread, which is BUG-004's
  mid-batch branch reached live for the first time, and `replies` refused to
  open four more threads. AGENTS.md's sentence "the budget guard has never
  refused a real poll" is now false and has been corrected.

  **It overshot the cap by 63%** — $1.6317 against $1.00. The guard runs before
  a poll and cannot know what one will cost, which is the known behaviour; what
  is new is the size, and the reason is this platform's unit. Each overshoot
  step here is a 5-credit comment page, where on TikTok it is a 1-credit one.

  **The provider half is five times the model half, which is true nowhere
  else.** $1.6317 with SocialCrawl against $0.3336 with the model, over the
  whole exercise. On every other platform the model dominates. The first run
  spent its entire cap before the classifier read a single comment, so its "0
  matches" measured the budget and not the platform — the comments had to be
  read separately, on credit already spent.

  **Read separately, they answer the platform's question yes.** The cap was
  raised and `live:instagram-comments` put all 89 stored comments through
  triage and classification, calling no provider. **Five matched at or above
  50, and the top scored 90** — the highest any comment has scored on any
  platform in this product, against TikTok's best of 82:

      90  "40s perimenopause skin. Retinol & azelaic acid destroy my barrier
           (very tight/dehydrated and sensitive skin). How can I safely treat
           age spots and permanent cheek acne scars without harsh ingredients?"

  That is the monitor's own problem statement said back to it by a stranger.
  The second, at 77, is a person on tretinoin for years still getting closed
  comedones and asking what else to try.

  **The leads are entirely in the tail, and the median describes this platform
  badly.** Of 89 comments, 56 were under ten characters and the median was
  four. Twelve passed sixty. **The two best matches are the two longest
  comments in the run**, at 233 and 289 characters. The other three matches are
  30 to 39 characters and are the weaker kind — "Will it work for hormonal
  acne?" at 64, and "Please write names of products" at 52, which the
  classifier itself notes names no problem and no product tried. Below about 65
  this platform degrades into purchase intent for somebody else's product,
  which is the same boundary US-044 found on TikTok.

  So the capture's median of 26 over one thread was not wrong, it was the wrong
  statistic. About one comment in seven carries words, and that seventh holds
  every lead. `platforms.ts` and the connector header said "expect fewer leads"
  and have been corrected: the platform is sparse and dear, not poor.

  **Triage cuts almost nothing here: 86 of 89 kept.** US-030 measured 20 of 26
  dropped on a Reddit thread and US-044 measured 4 of 60 on TikTok. This is the
  weakest yet, and for the same reason — under a product-recommendation video
  nobody is an expert answering, everybody is a potential customer. The stage
  costs more than it saves on this platform, and the saving argument for it is
  a Reddit argument.

  **One real fault found, and it was ours.** The first attempt crashed: the
  development database had not had migration 0035 applied, so `api_usage`
  refused the row after the search had already been billed. One credit was
  spent for nothing. `assertSourcesCanBeStored` exists to turn exactly this
  into a failed boot, and this instrument does not call it. Worth fixing in a
  follow-up rather than here.

  **Total spend for the whole ticket: about $2.08** — $0.106 capture, $1.6317
  provider, $0.3336 model, and $0.008 on the crashed run.
