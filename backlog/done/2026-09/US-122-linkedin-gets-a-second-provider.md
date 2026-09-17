---
id: US-122
title: LinkedIn gets a second provider
type: spike
priority: p2
created: 2026-09-11T18:44+08:00
parent:
area:
resolution: shipped
---

## Context

**LinkedIn has one provider offered, and it is the only platform here where
that is not for want of asking.** Apify fetches it since US-057. Two others
were measured and neither is available:

* **SocialCrawl** works and is switched off since US-053. It is the dearest of
  the three measured, $0.2030 for fifty posts, and its search is ordered by
  relevance rather than by date, so it returns posts weeks old. The connector,
  its fixtures and its tests all stayed. `notOffered` names the one measurement
  that would bring it back: this provider gaining a date window.
* **ScrapeCreators** was built, passed 34 tests, and was dropped in US-055 on
  the owner's decision. It finds posts through Google's index and then scrapes
  them. Freshness was measured and was fine; coverage was never measured, and a
  middleman that silently drops posts fails in a way no poll would notice. The
  work is in a named stash.

So this ticket is not "measure the next provider". It is "find one", and the
first half of the work is elimination rather than capture.

**Bright Data is the obvious name and it is probably not the answer.** Its
documentation says a LinkedIn post is collected by URL and discovered by
company URL, profile URL or article URL. Keyword discovery is listed for job
listings and not for posts. That is the same shape that disqualified Bright
Data for X in US-006 — `Available types: profile_url, profiles_array` — and a
provider that cannot find a stranger cannot serve a monitor, however good it is
at Reddit. **This is read from the documentation and not measured.** Ask the
account before believing it; a rejected call bills nothing.

**Bright Data's second route is a different product and needs its own answer.**
It sells a LinkedIn Posts dataset of about 120 million records with a Filter
Dataset API over it. That is a stored dataset filtered by field rather than a
live search, so the two questions are how fresh a record is and what one filter
run costs. A dataset that is a week behind is not a monitor.

**HarvestAPI sells directly, and that is a weaker second provider than it
looks.** `harvestapi/linkedin-post-search` is the actor Apify runs for us, and
its developer publishes its own API. A direct key would be a second bill and a
second account, which is what `provider` means here, but it is the same upstream
collection. An outage upstream takes both. Record that plainly if this becomes
the recommendation, because the reason the owner asked for two providers is not
only price.

**What every candidate must answer before anything else.** Can it find a
LinkedIn post from a keyword, written by a stranger the monitor has never named?
If not, the measurement stops there and costs nothing.

**Then the usual questions**, and US-056's list is the model for them: the whole
wire shape; whether the id is the activity id, which is what lets a post
collected through Apify not be stored again; what a run reports as charged;
whether a date order or a date window is offered and whether it holds; what a
search matching nothing costs; how long an answer takes; what a refused key
says; and whether comments carry an id, a date and a permalink.

**It is allowed to end with no second provider.** LinkedIn may be the platform
where one is all there is. If so, write that in the Log with the three
eliminations, and the answer stands until somebody publishes a new search.

## Acceptance

- [ ] Every candidate is named in the Log with the discovery question answered
      first: can it find a post by keyword, yes or no, and how that was
      established
- [ ] Bright Data's scraper API is asked rather than assumed, and its answer is
      recorded verbatim
- [ ] Bright Data's LinkedIn Posts dataset is assessed for freshness and for
      the cost of one filter run, or named as not assessed with the reason
- [ ] Any candidate that survives the discovery question has a capture script,
      scrubbed fixtures read by a person, and a recorded cost
- [ ] The ticket ends with one of two recommendations: build a named
      connector, with the number that decides it, or LinkedIn keeps one
      provider, with the list of what was eliminated and why
- [ ] Whether the candidate shares Apify's upstream is stated, if it does

## Notes

- Read [docs/sources.md](../../../docs/sources.md), *When only one provider can do
  the work*. It holds the X elimination, which is the worked example for this
  ticket.
- [US-054](US-054-linkedin-is-measured-at-the-other-provider.md),
  [US-055](US-055-linkedin-is-fetched-through-scrapecreators.md)
  and [US-056](US-056-linkedin-is-measured-at-apify.md) hold the
  three measurements already made. Do not repeat them.
- Reviving SocialCrawl by deleting `notOffered` is not this ticket's answer
  unless the date window exists now. Check the endpoint guide first: SocialCrawl
  publishes one per endpoint at zero credits.
- Two connectors cannot share a provider for one platform. The registry is keyed
  by the pair, so a second Apify actor is not a second provider.

## Log

- 2026-09-11T18:44+08:00 — Written. The owner asked for a second provider on
  every platform.

- 2026-09-17T01:35+08:00 — **Desk research, from public documentation.
  Nothing below is measured.** Written the day the owner said there is no
  good second choice on LinkedIn; [US-160](US-160-instagram-gets-a-second-provider.md)
  is the same work for Instagram.

  **Bright Data's scraper answers no from its own documentation**, as the
  Context predicted. The LinkedIn scraper page lists four datasets and their
  discovery modes, and for posts the whole sentence is "Discover posts by
  company or profile." Keyword discovery is listed for jobs and for profiles
  and not for posts. The acceptance list still asks for one call to the
  account, and that call is free. The Posts dataset was not assessed.

  **SocialCrawl's endpoint now lists a `sort_by` parameter**, beside
  `date_posted`, on its LinkedIn platform page. It changes nothing: the owner
  confirmed on 2026-09-17 that the connector is off on price, and a date
  order does not make $0.2030 for fifty posts cheaper. Not worth a call.

  **Three routes read LinkedIn without Google, and each has a catch.**

  * **Unipile** drives LinkedIn's own search — `keywords`, `sort_by:
    relevance | date`, `date_posted: past_day | past_week | past_month` — from
    €49 a month with unlimited calls. The catch is the `account_id`: every
    call runs through **the person's own connected LinkedIn account**, so the
    freshness is LinkedIn's and so is the risk of a restricted account. That
    is a fit for a self-hoster who accepts it and a hard thing to put on the
    hosted product's connections screen.
  * **Piloterr** publishes
    `/api/v2/linkedin/advanced/post/search?query=` and says each result
    carries "Post ID, URL & publishing date", the text, the author and the
    engagement, at one to two credits a call with fifty free. **It does not
    say whether it reads LinkedIn or Google's index**, and that is the first
    question, before any capture.
  * **Crustdata** has `/social_post/professional_network/search/live` at one
    credit a post, three with `exact_keyword_match`, and its own upstream.
    Live endpoints are "enabled on request" and plan-gated, the lowest tier
    is about $95 a month, and the site sells through a demo. That is the
    wrong shape for a key a person pastes; it may be a hosted-product
    question and it is not this ticket's answer.

  **Named and set aside.** A RapidAPI listing, "Fresh LinkedIn Profile
  Data", has a Search Posts endpoint with nothing published about method or
  dates; low priority. HarvestAPI's direct API is the actor's own upstream,
  which the Context already rules out. Every other keyword search found is an
  Apify actor, and the Notes already say a second actor is not a second
  provider.

  **Piloterr's price, read from its pricing page.** Subscription only: $49 a
  month buys 18,000 credits, about $0.0027 a credit, so a search call is
  $0.003 to $0.005 against Apify's $0.002 a post. Cheaper per page if a page
  holds more than a couple of posts; dearer for a self-hoster who would
  otherwise spend cents. 500 free credits on signup, so the capture is free.

  **The order to measure, then**: Piloterr's method by one call, and its
  page size; Unipile only if the owner accepts a person's own account as the
  credential.
- 2026-09-17T02:05+08:00 — **Piloterr is eliminated without a key.** Its docs index no
  longer lists a post search, the library page for it answers 404, and
  `api.piloterr.com/v2/linkedin/advanced/post/search` answers
  `403 Forbidden` — the same answer as a route that does not exist, where a
  documented route without a key answers `401 No X-API-Key header`. The
  product was withdrawn. LinkdAPI was checked the same hour and searches
  people, companies and jobs, not posts.

  **The candidate left is the "Real-Time LinkedIn Scraper API" on RapidAPI**
  (`linkedin-data-api.p.rapidapi.com`, `POST /search-posts`). Its tutorial
  documents `keyword`, `sortBy: date_posted | relevance` and
  `datePosted: past-24h | past-week | past-month`, and the parameters mirror
  LinkedIn's own `search/results/content/` URL field for field, so it reads
  LinkedIn and not Google — unmeasured. One call is one credit and a failed
  call is free. The plans, read from the listing: BASIC is free at 50
  requests a month and asks for a company email and a LinkedIn profile URL
  before approval; PRO is $175 a month for 50,000 credits, then $0.004 each.
  So it is a subscription, and a dear one for a self-hoster; the question a
  capture answers is how many posts one credit buys. A sibling listing,
  "Fresh LinkedIn Profile Data", has a `POST /search-posts` at "1 credit per
  every 20 results" on a $10 BASIC plan, and publishes no parameters; read
  its playground with a RapidAPI login before choosing between the two.

  `packages/engine/src/sources/providers/rapidapi/linkedin-fixtures/capture.mjs`
  is the capture for the first one. It needs `RAPIDAPI_API_KEY` in `.env`,
  spends five requests, and has run against a fake provider only.
- 2026-09-17T02:20+08:00 — **The owner declined RapidAPI on price**: $175 a
  month is too much, and there will be no integration with it for now. The
  capture script written an hour earlier is deleted in the same commit; it
  never ran, so nothing is lost but the file.

  That leaves LinkedIn where the Context said it might end. Every route
  found on 2026-09-17 is now eliminated, each for one reason:

  * ScrapeCreators — Google's index (US-055).
  * SocialCrawl — price (US-053, confirmed by the owner today).
  * Bright Data — no keyword discovery for posts, from its own docs.
  * Crustdata — live search is enterprise-only, on request.
  * Piloterr — the product was withdrawn; its route answers like one that
    does not exist.
  * LinkdAPI — searches people, companies and jobs, not posts.
  * HarvestAPI direct — Apify's own upstream.
  * Any other Apify actor — not a second provider, by the registry's key.
  * RapidAPI "Real-Time LinkedIn Scraper API" — $175 a month, declined.
  * RapidAPI "Fresh LinkedIn Profile Data" — same marketplace, $10 a month
    at one credit per twenty results, parameters unpublished. Not asked,
    because the owner declined the marketplace and not one listing.
  * Unipile — native and fresh, but it runs through the person's own
    LinkedIn account. Not a provider in this product's sense unless the
    owner decides it is.

  **LinkedIn keeps one provider.** Apify through HarvestAPI stays the only
  offer, and this ticket stays open only for a decision on Unipile or for a
  provider that does not exist yet. Bright Data's one free confirming call,
  in the acceptance list, is still owed.
- 2026-09-17T03:15+08:00 — **Closed: LinkedIn keeps one provider.** The
  owner accepted one provider on both platforms rather than Unipile's
  own-account model. Bright Data's confirming call was never sent; its
  documentation's answer stands. Reopen when somebody publishes a keyword
  search of LinkedIn posts behind a key a person can paste, at a price
  under Apify's $0.002 a post or with a freshness Apify lacks.
