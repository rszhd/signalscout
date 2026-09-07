---
id: US-036
title: A provider is rated per platform, from measurements
type: spike
priority: p2
created: 2026-09-06T11:48+08:00
parent:
area:
resolution:
---

## Context

**The goal is that one subscription is enough.** Today a person who wants
Reddit replies needs ScrapeCreators and a person who wants X needs SocialCrawl,
so somebody who wants both pays twice. Closing that means building the missing
connectors — and that work cannot be scoped until somebody knows which of them
can exist. This ticket is that knowing. It builds no connector.

**What is missing is not a list of endpoints. It is a comparison.** Each
connector already declares its own price, its billable unit, its per-poll
ceiling and whether it reads replies, and `decideProvider` already picks between
two that fetch one platform. What nothing holds is the answer to *"for this
platform, which provider is better, at what, and by how much"* — and that answer
is currently scattered across AGENTS.md prose, five connector headers and three
capture ledgers.

Five measurements from this month, to show what the matrix has to hold and why
prose cannot:

* A Reddit subreddit page cost **$0.075** through Bright Data and **$0.00376**
  through ScrapeCreators. Twenty times.
* A keyword across Reddit through SocialCrawl returned r/AskVet and r/TIdaL;
  the same words *inside* a subreddit returned seven posts, all on topic. Only
  SocialCrawl has that endpoint.
* A Reddit comment page is **1 credit for 25 rows** at ScrapeCreators and **5
  credits for a deep tree** at SocialCrawl. A YouTube comment page is **1 credit
  for 51 rows**.
* Bright Data cannot read replies at all. ScrapeCreators' `has_more: false`
  arrived with 33 of 58 comments missing; SocialCrawl's X `has_more: true` led
  to an empty page.
* One SocialCrawl credit is 8,118 micro-dollars; one ScrapeCreators request is
  1,880. Every cross-provider comparison has to convert.

**Most of this costs nothing to establish.** SocialCrawl's catalogue answers for
free: `/v1/utility/endpoints` reported 556 endpoints across 64 platforms on
2026-09-06, 30 of them social, and named 46 with a search endpoint — including
Quora, Hacker News, Threads, Facebook, Instagram, TikTok and GitHub. Credential
probes are free at both providers. So the matrix is mostly research, and the
credits go only where a claim has to be tested.

**One thing this ticket must not become: a rating invented from
documentation.** This repository has caught four documented claims wrong in one
month: a `published_after` that answers 400, dates drifting 283 days against a
documented 120, and two completeness flags that lied in opposite directions.
**Every cell carries how it was established** — measured here, read from the
provider, or unknown — and "unknown" is a legal and common value.

## Acceptance

- [ ] A matrix exists as data rather than prose, one row per (platform,
      provider), holding at least: keyword search, channel or scoped search,
      replies, deletion verification, the billable unit, the price of one unit
      in micro-dollars, and what one unit bought when it was measured
- [ ] Every cell says how it was established: measured by us with the fixture or
      ledger that proves it, read from the provider's own catalogue, or unknown
- [ ] Unknown is used freely. A matrix with no gaps after one session is a
      matrix somebody filled in from memory
- [ ] The five connectors this product ships are covered, and their cells are
      filled from what already exists rather than re-measured
- [ ] The matrix covers the four platforms this product ships — Reddit, X,
      LinkedIn, YouTube — against the three providers it holds keys for. Not
      the 46 platforms a catalogue lists: a platform nobody polls is not a row
      worth measuring
- [ ] Per platform, the Log names which provider is better and at what, in one
      sentence each, with the number behind it
- [ ] The Log says what a person with one subscription can and cannot do today,
      per provider, which is the question this ticket exists to answer
- [ ] The Log lists the connectors that would have to be built for either
      subscription to be enough, so [US-037](US-037-one-subscription-is-enough.md)
      can be scoped

## Notes

- Depends on nothing. It reads free catalogues and committed fixtures.
- Costs near nothing: SocialCrawl's `/v1/utility/endpoints` and
  `/v1/utility/endpoint` both report `credits_used: 0`, and a credential probe
  is free at both providers. Budget a few credits for a claim that has to be
  tested, and say in the Log which ones were.
- ScrapeCreators has no free catalogue that we know of. What it can do is read
  from its own documentation and marked as read, not measured, until something
  calls it.
- The catalogue also lists search endpoints for Quora, Hacker News, Threads,
  Facebook, Instagram, TikTok and GitHub. That is worth writing down once, in a
  sentence, and then leaving alone: each is a fifth network and PLAN.md's rule
  covers them. This ticket measures what we poll.
- The existing data lives in `ConnectorDescriptor` — `billableUnit`,
  `pricePerUnitMicros`, `maxUnitsPerQueryPoll`, `canFetchReplies`,
  `replyPricePerUnitMicros`. Extending that record is the obvious home for the
  built rows, and the unbuilt rows need somewhere else. Decide which, and say
  why in the commit.
- docs/costs.md holds the rule that every figure is an estimate, and any price
  shown to a person inherits it. A matrix that reads as a quote would be a new
  way to say something this repository is careful not to say.
- Read docs/sources.md before proposing the shape: it already holds two lists,
  *adding a provider* and *adding a platform*, and this may belong beside them.

## Log

- 2026-09-06T11:48+08:00 — Written after the owner asked for a per-platform
  provider rating so that one subscription can be enough, and scoped on their
  clarification to the four platforms already integrated rather than to every
  platform a catalogue lists. The ticket is scoped
  to knowing rather than building, because the build cannot be scoped first, and
  it is scoped hard against inventing a rating from documentation — four
  documented claims have been measured wrong this month.
