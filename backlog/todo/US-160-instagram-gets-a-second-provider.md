---
id: US-160
title: Instagram gets a second provider
type: spike
priority: p2
created: 2026-09-17T01:35+08:00
parent:
area:
resolution:
---

## Context

**Instagram has one provider offered, and the one candidate measured is the
one the owner is least willing to take.** SocialCrawl fetches it since US-049.
US-120 measured ScrapeCreators on 2026-09-11 and recommended building it —
$0.0019 for fifteen comments against SocialCrawl's $0.0406 — but that endpoint
finds reels through Google's index, which is the shape US-055 dropped for
LinkedIn. The owner has not decided, and on 2026-09-17 said there is no good
second choice on Instagram or LinkedIn. So this ticket asks the question
US-120 could not: **is there a second provider that reads Instagram's own
search?**

**What a candidate must answer first is unchanged**: can it find a post from
a keyword, written by a stranger the monitor has never named, and does the
post carry a date. US-120 found that ScrapeCreators' native endpoint fails
the second test — not one post carried `taken_at` — so the date question is
not a formality on this platform.

**The desk research, done 2026-09-17 from public documentation and nothing
measured.** Every price and claim below is read, not captured.

* **HikerAPI is the candidate to measure first.** It is the SaaS behind
  `instagrapi`, and it publishes `/v2/fbsearch/reels` — the surface
  Instagram's own app uses for the Reels tab inside search — and
  `/v2/fbsearch/topsearch`, the blended search. Both read Instagram directly,
  so US-055's objection to a Google middleman does not apply. It is
  self-serve at **$0.60 per 1,000 requests** with 100 free, and every request
  is priced the same, so a comment page would cost about $0.0006 against
  SocialCrawl's $0.0406 and ScrapeCreators' $0.0019. It returns Instagram's
  raw JSON, so `taken_at` should be there — `instagrapi` builds `Media` objects
  from the same payload — and **that is the claim the capture must prove
  before anything else**. It also has hashtag medias and comment endpoints.
* **Apify is the fallback that needs no new account, and it counts here.**
  US-122 rules that a second Apify actor is not a second provider for
  LinkedIn, because the registry is keyed by the pair. `(instagram, apify)`
  is a **new pair**, and the token, the provider id and the schema constraint
  all exist since US-057. Two actors are worth knowing about. The official
  `apify/instagram-scraper` **has no keyword search**: its `search` resolves
  to hashtags, profiles or places, and comments need a post URL. A
  marketplace actor such as `viralanalyzer/instagram-keyword-search-scraper`
  calls Instagram's `/api/v1/fbsearch/web/top_serp/`, returns a `timestamp`,
  and bills $1.00 per 1,000 posts plus compute — and returns comment counts
  but **no comment text**. The marketplace risk from US-057 applies whole: the
  actor can change under us without the API changing.
* **SociaVault** publishes search and hashtag-search endpoints at 1 credit a
  request, $29 for 6,000 credits, 50 free, and its reels carry `taken_at`.
  Whether the search is native or indexed is not written down. Cheap to ask.
* **EnsembleData** has `/instagram/search?text=` and does not publish what it
  returns. From $100 a month with a daily cap. Weaker than the three above.

**Eliminated from documentation, so the capture need not spend on them:**

* **Bright Data**: posts and reels are "discover by profile URL", a hashtag
  scraper exists, and nothing searches by keyword. Snapshots take minutes.
* **Data365**: hashtag and location search only, €300 a month, sales-led.
* **Meta's own Graph API**: hashtag only, 30 hashtags per seven days,
  `recent_media` covers the last 24 hours, needs a business account and an
  app, and returns no comments on media the account does not own.

**The question this ticket ends with is the one US-120 left open.** If a
native provider is measured and works, the owner's objection to the
Google-indexed one becomes moot and US-120's build is not needed. If none
does, the choice is US-120's connector or one provider, and that is the
owner's call, made once with both measurements in front of them.

## Acceptance

- [ ] Every candidate above is named in the Log with the discovery question
      answered first: can it find a post by keyword, yes or no, and how that
      was established
- [x] HikerAPI is captured with a real key: the reels search, one page of
      comments, and whether `taken_at` is on every post — the answer that
      failed ScrapeCreators' native endpoint in US-120
- [ ] The three US-049 faults are each asked of the surviving candidate and
      answered in the Log: a search with no window, `has_more` beside an
      empty page, and null comment fields
- [ ] Every question US-119 lists is answered for the surviving candidate,
      or named as unanswered with the reason
- [x] Whether the id is the nineteen-digit media id SocialCrawl returns is
      recorded, so a reel is not stored twice
- [ ] Any candidate that survives has a capture script, scrubbed fixtures read
      by a person, a `ledger.json`, and a recorded cost
- [ ] The ticket ends with one of three recommendations: build a named
      connector, with the number that decides it; build US-120's; or Instagram
      keeps one provider, with the list of what was eliminated and why

## Notes

- Read [docs/sources.md](../../docs/sources.md), *When only one provider can
  do the work* and *adding a provider*, and
  [docs/instruments.md](../../docs/instruments.md) before running anything.
- [US-120](../done/2026-09/US-120-instagram-is-measured-at-scrapecreators.md)
  holds the measurement already made and the coverage question it left open.
  Do not repeat it. Its capture script in
  `scrapecreators/instagram-fixtures/` is the worked example; it reads
  `comment_count` before choosing a comment target, which the first run of
  two captures forgot.
- `socialcrawl/instagram-fixtures/capture.mjs` asks the three US-049
  questions; ask them again of the new provider, word for word.
- HikerAPI: https://hikerapi.com/ and the OpenAPI document at
  https://api.hikerapi.com/openapi.json, which is where the endpoint names
  and the `safe_int` parameter come from.
- `packages/engine/src/sources/providers/hikerapi/instagram-fixtures/capture.mjs`
  is the capture. It needs `HIKERAPI_ACCESS_KEY` in `.env` and spends about
  eight requests.
- Apify: https://apify.com/apify/instagram-scraper and
  https://apify.com/viralanalyzer/instagram-keyword-search-scraper.
- SociaVault: https://docs.sociavault.com/api-reference/instagram/reels.
- [US-122](US-122-linkedin-gets-a-second-provider.md) is the same question
  for LinkedIn, and its Log holds the desk research made the same day.

## Log

- 2026-09-17T01:35+08:00 — Written, after the owner said there is no good
  second choice on Instagram or LinkedIn. The candidate list above is desk
  research from public documentation; nothing in it has been measured.
- 2026-09-17T02:05+08:00 — Wrote the HikerAPI capture script. It has run
  against a fake provider and not against the real one. The dry run caught one thing worth
  keeping: Instagram's media `pk` is nineteen digits, past what `JSON.parse`
  keeps exactly, and three distinct reels deduplicated into one. The
  provider's `safe_int=true` sends every big integer as a string, so the
  script sends it on every call and a connector must too. Also confirmed
  from the OpenAPI document: `/v2/fbsearch/reels` takes no date window at
  all, so question 4 can only measure how wide a page is; `/v3/fbsearch/reels`
  is marked deprecated for duplicate pages; and `/sys/balance` is free and
  moves in real time, which is what the ledger reads.
- 2026-09-17T02:50+08:00 — **Measured. HikerAPI reads Instagram's own
  search, every reel carries a date, and the id is SocialCrawl's.** Three
  runs, the first two to fix the scrubber, about fifteen requests in all —
  under two cents. The fixtures committed are the third run's.

  **Question 1, the one that decides it: 12 of 12 reels carry `taken_at`**,
  an epoch in seconds, on every page of every run. ScrapeCreators' native
  endpoint carried none; this one carries all.

  **The id is the same nineteen-digit media id SocialCrawl returns.**
  `pk: "3864836943138356426"` here against `id: "3919322149840844514"` in
  `socialcrawl/instagram-fixtures/search-keyword.json` — the same number
  space, so a reel found through both is stored once. **It arrives as a
  string only because `safe_int=true` is sent**; without it `JSON.parse`
  rounds it, which the dry run proved by collapsing three reels into one.
  A connector must send it on every call.

  **A page is twelve reels, ordered by relevance, with no window to send.**
  The first page for `flaky tests` ran 31 March to 16 September 2026 in one
  run and 3 April 2024 to 30 August 2026 in another. Ten of the twelve were
  about test automation; the other two were a chemistry lesson and a
  medical reel that matched a word. Captions are long — median 830
  characters, up to 1,680 — where SocialCrawl's Instagram search in US-049
  measured a median of 26 on comments.

  **Paging repeats, and it is not deterministic.** Page two, followed by
  `reels_max_id` and `rank_token`, repeated 7, 6 and 3 of page one's twelve
  across the three runs, and `page_index` on the *first* page came back 13
  and 14. The provider marks its own `/v3/fbsearch/reels` deprecated for
  "pagination issues with duplicate results"; the v2 one has them too. A
  connector deduplicates by `pk` and treats a second page as a third of a
  page's worth of new reels.

  **`has_more` is true on every page, including the one that matches
  nothing.** The impossible phrase returned six unrelated reels and was
  billed. So this provider answers "nothing" the way ScrapeCreators' TikTok
  and SocialCrawl's LinkedIn do: with something, for money. US-049's second
  fault — `has_more` beside an *empty* page — did not reproduce, because
  there is no empty page.

  **Comments: 16 a page, every one with `pk`, `text`, `created_at` and a
  `user`, and no field null on every comment.** US-049's third fault does
  not reproduce. There is no permalink on a comment; Instagram's raw shape
  never carries one, so a connector builds
  `instagram.com/p/<code>/c/<pk>/` and somebody must open one before it
  ships, by AGENTS.md's rule. `next_page_id` is a cursor. **The sample is
  worthless as a lead sample**: the busiest reel was engagement bait
  ("Comment PROMPTS I'll send you the full PDF") and its sixteen comments
  ran a median of six characters — "Prompts", "🙌". The script's rule of
  "the busiest reel" chose it; the next run should choose the busiest reel
  whose caption is about the query.

  **Money.** A refused key answers 401 and is free. A working key with no
  query answers 422 and **is billed** — the pricing page says any answered
  request is, 400 and 404 included. `/sys/balance` is free, but its
  `requests` counter lags: the ledger shows one call at −1 and a run of
  five billable calls moving the counter by three. Read a run's total, not
  a call's. At $1.00 per thousand on the entry rate, a search page is
  $0.001 and a comment page is $0.001, against $0.008 and $0.041 at
  SocialCrawl. A search took 5.1 to 7.5 seconds; a comment page 2.1 to
  3.6. The account's rate limit is one request a second.

  **The scrubber was wrong three times, and reading the files caught each.**
  `user_id` on every comment and caption is the commenter's `pk` under a
  name outside any person container; `ig_artist` and
  `account_overlay_user` are people the container list had not named; and
  395 signed CDN addresses sat under keys the field list did not have,
  then twelve more inside a bare array. The rules are by shape now — any
  object with a `username` is a person, any `cdninstagram.com` or
  `fbcdn.net` address is media — and the leak check found nothing on the
  third run. One thing the rule cannot catch stays: a caption's hashtags,
  and one hashtag on this page is a person's name. Captions are the text
  this product classifies and every capture here keeps them.

  **Recommendation: build it, as the second Instagram provider.** It is
  native, so the objection to US-120's route does not apply; it is eight
  times cheaper on search and forty times cheaper on comments than the one
  offered; and it deduplicates against it. What it is not is a better
  *finder* — relevance order over five years with no window means a poll
  reads twelve and keeps the few inside `since`, every time. The provider
  id would be `hikerapi`, the credential field `accessKey`, and the
  vocabulary migration goes in the same change, by AGENTS.md's rule.

  **Not measured**: a rate limit, an outage, hashtag search as a second
  route, and whether `/v2/fbsearch/topsearch` finds posts that are not
  reels. Every number here is one keyword on one day.
