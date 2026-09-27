---
id: US-425
title: Instagram comments are read at a cheaper provider
type: spike
priority: p2
created: 2026-09-26T02:32+08:00
parent: US-160
area: sources
resolution:
---

## Context

**On Instagram the lead is in the comments, and the comments are the dearest
item this product fetches.** SocialCrawl bills a page of fifteen comments at
five credits, $0.041, about $0.0027 a comment: roughly thirteen times an X
reply at SocialData's price, and five to six times a YouTube or TikTok comment
at ScrapeCreators (signalscout-radar US-417 measured those). US-413 in
signalscout-radar paid about $0.49 for comment pages that returned nothing it
could read.

**US-120 and US-160 looked for a second Instagram provider and closed with
one.** Every route was refused for its *search*: ScrapeCreators' native search
carries no date; its reels search is Google's index; HikerAPI's search has no
date window and ranks by relevance. None was refused for its *comments*, and
the comments were cheap everywhere else: ScrapeCreators $0.0019 for fifteen,
HikerAPI $0.001 for sixteen.

**So the question this ticket asks is narrower than US-160's.** Keep
SocialCrawl's search — native, dated, $0.00027 a reel — and read the comments
of the reels it finds somewhere cheaper, by the reel's id. A comment read by id
needs no search, no window and no ranking, so the objections that closed
US-160 do not reach it. US-160 found HikerAPI's media id is the same nineteen-
digit number SocialCrawl returns.

What would decide it:

1. **Coverage.** For the same reel, does the cheaper provider return the same
   comments SocialCrawl does, and as many?
2. **Shape.** Does every comment carry an id, a text and a date, so a
   connector can cut on `since` and deduplicate?
3. **Price, measured.** What each provider actually billed for the same reels.
4. **The two not asked in US-160.** SociaVault and EnsembleData, from their
   public documentation: comments by id, price, and whether their search is
   native and windowed.

## Acceptance

- [x] Reels found by SocialCrawl's search, each with comments, have their
      first comment page read at SocialCrawl, HikerAPI and ScrapeCreators
      (three, not five: see the Log)
- [x] The Log gives, per provider: comments returned, overlap with
      SocialCrawl's by comment id, fields present, and cost
- [x] The Log records SociaVault and EnsembleData from their documentation
- [x] The Log recommends one of: build a split connector (SocialCrawl search,
      another provider's comments), keep SocialCrawl alone, or ask more

## Notes

- Endpoints, from the US-120 and US-160 capture scripts:
  HikerAPI `GET /v2/media/comments?id=<pk>&safe_int=true` with
  `x-access-key`; ScrapeCreators `GET /v2/instagram/post/comments?url=<post>`
  with `x-api-key`.
- `safe_int=true` on every HikerAPI call, or `JSON.parse` rounds the id
  (US-160).
- The owner closed US-160 on 2026-09-17 with one provider; this reopens only
  the comment half, at the owner's request on 2026-09-26.

## Log

- 2026-09-26T02:36+08:00 — **Measured, and it found two engine bugs first.**
  Two SocialCrawl searches ("skincare routine", "budget laptop"), then three
  reels whose first comment page HikerAPI said held five comments or more.
  Three reels, not five: each SocialCrawl comment page is 5 credits, and five
  would have cost about twice what the owner was told.

  **SocialCrawl's connector kept 0 of the 9, 13 and 14 comments the provider
  returned.** One raw page (a cache hit, 0 credits) shows why: every comment
  now carries `post_id`, set to the reel's shortcode, and the connector
  compares it with the media id. BUG-426.

  **The engine counts a SocialCrawl comment page at 25 credits, not 5.**
  The client reports `credits_used` as units and the connector prices a unit
  at 5 credits. BUG-427. This run's engine estimate was $0.64; by the
  provider's price list it was about $0.15.

  **Coverage is the same.** For one reel, all three providers returned the
  same 9 comments with the same comment ids, in different orders. HikerAPI
  and ScrapeCreators returned comments on all three reels, every one with an
  id, a text and a date.

  | Provider | One comment page | Comments on it | Per comment |
  |---|---|---|---|
  | SocialCrawl | 5 credits, $0.041 | up to 15 | about $0.0027 |
  | ScrapeCreators | 1 credit, $0.00188 | 9–14 here, up to 15 | about $0.00013 |
  | HikerAPI | $0.001 | 9–16 here, up to 16 | about $0.00006 |
  | SociaVault (docs) | 1 credit, about $0.005 at $29 for 6,000 | not published | not known |
  | EnsembleData (docs) | 1 unit | 30 | about $0.00007, on a monthly plan ($100 for 1,500 units a day) whose units expire daily |

  **One more thing the raw page shows:** SocialCrawl labels every comment
  with `computed.labels.purchase_intent.p` and `question.p`, free. A
  connector could use them to skip comments before the model reads them.

  **Recommendation: fix BUG-426 and BUG-427 first, then build the split.**
  Keep SocialCrawl's search, which is native and dated, and read comments at
  ScrapeCreators — an instance that reads Reddit, YouTube or TikTok through
  it already holds the key — at about 20 times less per comment. HikerAPI is
  cheaper still and would be the choice if a second account is acceptable.
  SociaVault and EnsembleData need a call each before they can be compared.

