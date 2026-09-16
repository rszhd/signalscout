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
- [ ] HikerAPI is captured with a real key: the reels search, one page of
      comments, and whether `taken_at` is on every post — the answer that
      failed ScrapeCreators' native endpoint in US-120
- [ ] The three US-049 faults are each asked of the surviving candidate and
      answered in the Log: a search with no window, `has_more` beside an
      empty page, and null comment fields
- [ ] Every question US-119 lists is answered for the surviving candidate,
      or named as unanswered with the reason
- [ ] Whether the id is the nineteen-digit media id SocialCrawl returns is
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
- HikerAPI: https://hikerapi.com/ and the Swagger at
  https://api.hikerapi.com/docs. The endpoint names above come from its
  changelog; confirm them against the Swagger before writing a script.
- Apify: https://apify.com/apify/instagram-scraper and
  https://apify.com/viralanalyzer/instagram-keyword-search-scraper.
- SociaVault: https://docs.sociavault.com/api-reference/instagram/reels.
- [US-122](US-122-linkedin-gets-a-second-provider.md) is the same question
  for LinkedIn, and its Log holds the desk research made the same day.

## Log

- 2026-09-17T01:35+08:00 — Written, after the owner said there is no good
  second choice on Instagram or LinkedIn. The candidate list above is desk
  research from public documentation; nothing in it has been measured.
