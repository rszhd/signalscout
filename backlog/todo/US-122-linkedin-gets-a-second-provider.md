---
id: US-122
title: LinkedIn gets a second provider
type: spike
priority: p2
created: 2026-09-11T18:44+08:00
parent:
area:
resolution:
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

- Read [docs/sources.md](../../docs/sources.md), *When only one provider can do
  the work*. It holds the X elimination, which is the worked example for this
  ticket.
- [US-054](../done/2026-09/US-054-linkedin-is-measured-at-the-other-provider.md),
  [US-055](../done/2026-09/US-055-linkedin-is-fetched-through-scrapecreators.md)
  and [US-056](../done/2026-09/US-056-linkedin-is-measured-at-apify.md) hold the
  three measurements already made. Do not repeat them.
- Reviving SocialCrawl by deleting `notOffered` is not this ticket's answer
  unless the date window exists now. Check the endpoint guide first: SocialCrawl
  publishes one per endpoint at zero credits.
- Two connectors cannot share a provider for one platform. The registry is keyed
  by the pair, so a second Apify actor is not a second provider.

## Log

- 2026-09-11T18:44+08:00 — Written. The owner asked for a second provider on
  every platform.
