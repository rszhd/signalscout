---
id: US-435
title: A caller may let a monitor's first poll read more pages of each input
type: feature
priority: p1
created: 2026-09-29T20:04+08:00
parent:
area: sources
resolution:
---

## Context

Every paging connector stops one input after two pages in one poll: forty
tweets on X, about fourteen posts for a Reddit keyword. The cap is right for
the polls it was sized on. A monitor polls many times a day, each poll asks
only for what is new since the last one, and two pages is rarely reached.

The first poll is different. It has no window, so the two pages are the
newest forty tweets and nothing older, whatever the query's history holds. A
monitor that polls often fills in from there. A caller that polls once a day
with one query per platform never does: every poll it runs reads about 54
posts. On SignalScout's own production monitors the best queries matched
about one post in a hundred, so 54 posts give half a match. A private
experiment on these packages (US-434) found exactly that twice: two scans,
54 posts each, no match.

So the caller may raise the page count, and only for the first poll:

- `SearchRequest` gains an optional `pagesPerInput`. A connector that pages
  by cursor uses it in place of its own cap when it is set. A connector that
  buys one fixed batch per input ignores it.
- `startWorker` gains an optional `firstPollPagesPerInput`. The collect step
  passes it only while `last_polled_at` is empty, and lets that poll read
  that many pages of each input for each platform.

**Nothing changes when the option is not set.** The self-hosted application
and the hosted one do not set it, so their polls and their cost projections
stay as they are. The cost test still projects an ordinary poll: a raised
first poll is one poll's spend, counted in `api_usage` like any other, and
the budget guard checks the monthly cap before it as before.

## Acceptance

- [x] With `pagesPerInput` set, SocialData's X connector reads up to that
      many pages of one query; without it, two.
- [x] The same holds for every other connector that pages by cursor.
- [x] A worker started with `firstPollPagesPerInput` reads that many pages
      on a monitor's first poll, and the connector's own cap on every later
      poll.
- [x] A worker started without it polls exactly as before.
- [x] The option refuses a value below 1 or above a fixed ceiling.
- [x] `docs/pipeline.md` and `docs/sources.md` name the option beside the
      caps, and `CHANGELOG.md` says what it changes for a consumer.
- [x] The suite passes.

## Notes

- Caps: `maxPagesPerQuery` in `socialdata/x.ts` and
  `socialcrawl/linkedin.ts`, `maxPagesPerInput` in the other paging
  connectors, `maxPagesPerPoll` in `pipeline/src/worker/collect.ts`.

## Log

- 2026-09-29T20:04+08:00 — Written. The owner asked for the option, with the default unchanged.
- 2026-09-29T20:10+08:00 — Built. `pagesPerInputFor` in `engine/src/sources/pages.ts` is the
  rule, and the ten connectors that page by cursor stop an input with it:
  SocialData X, SocialCrawl X, Reddit, YouTube, TikTok, LinkedIn and
  Instagram, ScrapeCreators Reddit, YouTube and TikTok. HarvestAPI, Apify
  and Bright Data buy one batch per input and ignore it. The first poll's
  own page cap grows to the count times the platform's inputs. Tests for X,
  ScrapeCreators Reddit, the helper's range, and the collect step (first
  poll, later poll, no option, a refused count). The full suite passes,
  2,559 tests. Not yet run against a real provider.

