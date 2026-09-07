---
id: US-054
title: LinkedIn is measured at the other provider
type: spike
priority: p2
created: 2026-09-07T12:57+08:00
parent:
area:
resolution: shipped
---

## Context

**ScrapeCreators publishes a LinkedIn keyword search, and nobody has called
it.** `GET /v1/linkedin/search/posts` takes `query`, `date_posted` and
`cursor`, and the cursor stops at 11 — about twelve pages a query. It is one of
six LinkedIn endpoints, beside a profile, a company page, company posts, a post
and a post transcript.

**US-053 turned LinkedIn off because SocialCrawl charges $0.2030 for fifty
posts.** This ticket is the way back. ScrapeCreators bills one credit a request
at $0.00188, which we measured on Reddit — so if a LinkedIn call is one credit
and returns ten posts, fifty posts cost $0.0094, and if it returns twenty-five,
$0.0038. Twenty-two times cheaper, or fifty-four. Either would make the
platform worth offering again.

**Every one of those numbers is arithmetic on an assumption.** ScrapeCreators
publishes no per-endpoint price and no page size. The provider reports
`credits_charged` on every answer and our Reddit connector already reads it, so
the true cost is one call away — and until that call is made, no price goes in
the code. US-014 cost $0.042 to learn that cost comes from units and volume
comes from posts.

**The freshness question is the one that can kill this.** The endpoint's own
description says it finds posts through Google Search and then scrapes the
public page. A post has to be indexed before it can be found, and this product
wants a person who wrote something this week. US-028 measured SocialCrawl's
LinkedIn answers running 15 August to 4 September on a page captured in
September. If ScrapeCreators is worse than that, the price does not matter.

**Four answers decide it, and three of them are free to be wrong about.** How
many posts a page holds, how many credits it costs, whether the answer is
ordered by date or by relevance, and how old the newest post is. US-028's
capture found four contradictions between the two providers on the same
platform, so nothing SocialCrawl proved travels here.

## Acceptance

- [x] A capture script calls the endpoint with a key, records what came back,
      and writes what each call was charged beside the fixtures — the shape
      `linkedin-fixtures/capture.mjs` already uses
- [x] The fixtures are scrubbed of names and job headlines, and were read by a
      person before being committed
- [x] Four numbers are recorded in the Log: posts per page, credits per call,
      the ordering of the answer, and the age of the newest post
- [x] The run's total cost is recorded, in credits and in dollars
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it

## Notes

- **This spends money on a real provider, so it is an instrument.** The rules
  in AGENTS.md, *Commands*, apply: a fixture we wrote is evidence about our own
  parser and none about the wire format.
- ScrapeCreators gives 100 credits free on signup, and we already hold a key
  for Reddit. This run should cost cents at most. Keep it lean and say what it
  did not ask.
- Read `docs/sources.md`, *adding a provider*, before writing any connector
  code. This ticket is the measurement only; the connector is a second ticket
  and should not be started inside this one.
- Do not reuse SocialCrawl's LinkedIn parser without checking. US-028 found
  the two providers disagreeing about ordering, about windows and about what an
  empty answer means, on the same platform.
- Its sibling is [US-053](US-053-a-connector-ships-without-being-offered.md),
  which is the switch this ticket's answer would flip.

## Log

- 2026-09-07T12:57+08:00 — Written beside US-053. The owner turned LinkedIn off
  on price and asked what the other provider charges; the documentation does
  not say, so the only honest answer is a measurement.

- 2026-09-07T13:22+08:00 — Ran the capture twice, for **5 credits in total,
  $0.0094**. The committed fixtures are the second run: 3 billed calls, balance
  2023 to 2020.

  **The four numbers. One page is 10 posts for 1 credit**, which is 188
  micro-dollars a post and **$0.0094 for fifty, against SocialCrawl's
  $0.2030** — twenty-two times cheaper, measured rather than projected. The
  answer is **ordered by relevance, not by date**: an unfiltered page ran 4
  April 2025 to 4 September 2026 in no order. The newest post on that page was
  three days old.

  **The freshness risk is closed, and it was the one that could have killed
  this.** `date_posted` takes five values — `last-hour`, `last-day`,
  `last-week`, `last-month`, `last-year` — and it works: `last-week` returned a
  full page of 10, every one inside the window, the newest one day old, sharing
  only 2 posts with the unfiltered page. A post is findable the day after it is
  written, so searching Google's index first is not the handicap it looked
  like.

  **Comments arrive free inside the search page.** 72 of them across 30 posts,
  a median of 177 characters and 52 over sixty — far more substantial than
  Instagram's median of 26 or TikTok's 54. On this provider a page is 10 posts
  *and* their comments for one credit, where SocialCrawl's LinkedIn connector
  reads no comments at all. They carry no id, no date and no permalink —
  `linkedinUrl` is the commenter's profile, not the comment — so they can be
  read but not linked, which US-047's rule says a match needs.

  Four more answers. **An empty search is free**: a phrase that cannot occur
  answers 404 "No posts found" and charges 0, where SocialCrawl bills the same
  question in full and returns ten unrelated posts. **The credential probe is
  free**, like Reddit's: a wrong key is 401 "Invalid API key", and a call with
  no query is 400 charged 0. **The cursor is a page number**, returned as
  `cursor: "2"` and documented to stop at 11, so a query is about 120 posts.
  Page two shared none of page one's ten. And **the answer is stable**: two
  runs fifteen minutes apart returned the same ten ids in the same order.

  **It is slow.** 9.2 to 11.4 seconds a call, against 1.8 to 4.9 for this
  provider's Reddit endpoints. It searches Google and then scrapes each page,
  and a poll's timeout has to be set from that rather than from the sibling.

  One thing the capture got wrong and fixed. The scrubber cut a post URL at its
  **last** underscore and destroyed the activity id of the one post whose title
  held one — and the URL is the only identifier this provider returns, with no
  `id` field on a post at all. Cutting at the first underscore is correct,
  because a LinkedIn slug uses hyphens. That is the second time a LinkedIn
  capture's scrubber has been wrong in a way only reading the output showed.

- 2026-09-07T13:24+08:00 — **Recommendation: build the connector.** The number
  that decides it is $0.0094 against $0.2030 for fifty posts, and the window
  that makes those fifty recent.

  Two warnings travel with it, and neither is the provider's fault. **The noise
  is exactly what US-028 described** — of the ten posts inside `last-week`,
  most are articles written to be seen and one is a vendor's product update.
  That is on-topic expertise-signalling, which a pre-filter cannot catch, and a
  cheaper provider does not make it a better platform. **And the comments,
  which are the free half and the substantial half, cannot be linked.** Every
  other platform here gives a match a URL that opens the comment; this one
  would give the commenter's profile.

  So the connector is worth building and the platform is still worth
  doubting. The next ticket builds it; the one after that should put a hundred
  of these comments through the classifier before anybody calls LinkedIn a
  source of leads.

- 2026-09-07T13:41+08:00 — Asked the third provider the same question, after
  the owner raised it. **Bright Data cannot search LinkedIn.** Its posts
  dataset `gd_lyy3tktm25m4avu764` answers a keyword discovery trigger with
  `Incorrect discovery collector id Available types: url, profile_url,
  company_url` — so a caller has to know whose posts it wants, and a stranger
  describing a problem cannot be found at all.

  That is the same refusal US-006 got from the same provider's X dataset
  (`Available types: profile_url, profiles_array`). **Bright Data has now
  failed the discovery question on two of the three platforms it has been
  asked about**, and Reddit is the exception rather than the rule. The reason
  is structural and not an oversight: it is a profile-scraping and bulk-dataset
  business, which answers "what has this account posted" where this product
  asks "who is describing this problem now".

  The probe was free. An empty input list cannot start a collection, so all
  four discovery types were refused before any work happened — the same trick
  that makes the Reddit credential probe free.

  Its price, for the record: **$1.50 per 1,000 records** pay-as-you-go, read
  from brightdata.com/pricing/web-scraper on 2026-09-07, which is the figure
  `brightdata/reddit.ts` already carries. It falls to $1.30 on the $499 monthly
  plan, and there is a free tier of 5,000 records a month. If it could search
  LinkedIn, fifty posts would cost $0.075 — eight times ScrapeCreators'
  $0.0094. Its separate marketplace dataset is $250 per 100K records, but that
  is a bulk file bought once, not a live search.

  **One advantage of Bright Data's is unaffected by any of this**, and it is
  why the connector stays: per-record billing means an empty search costs
  nothing by construction rather than by refund policy, and US-015 has measured
  that Bright Data returns explicit deletion evidence where ScrapeCreators is
  ambiguous for both live and removed posts. That is the open acceptance box on
  the deletion ticket, and Bright Data is currently the only provider that
  closes it.
