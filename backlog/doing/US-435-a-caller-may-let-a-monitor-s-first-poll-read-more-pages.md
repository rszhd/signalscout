---
id: US-435
title: A caller may let a monitor's first poll read more pages, and give it a window
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

**The first poll may also have a window.** With no window, a quiet query's
newest pages reach back months: two of eleven matches in one US-434 scan were
70 days and 1.5 years old. `startWorker` gains an optional
`firstPollWindowDays`, and a first poll with no coverage asks only for posts
from that many days back. Later polls keep to their coverage.

**Nothing changes when an option is not set.** The self-hosted application
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
- [x] A worker started with `firstPollWindowDays` asks a first poll for
      posts from that many days back and stores nothing older; a later poll
      keeps to its coverage; without it a first poll has no window.
- [x] The window refuses a value below 1 day or above 365.
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

- 2026-09-29T21:33+08:00 — The owner added the first-poll window to this ticket. `firstPollWindowDays`
  on `startWorker`, 1 to 365, used only when a unit has no continuation and
  no coverage on a first poll. Tests first: the window reaches the
  connector and only posts inside it are stored; a later poll keeps its
  coverage; no option, no window; out-of-range values are refused. The full
  suite passes, 2,566 tests. Not yet run against a real provider.
- 2026-09-29T23:04+08:00 — The owner wants a phrase searched inside each subreddit for Lookout.
  ScrapeCreators has `GET /v1/reddit/subreddit/search` (subreddit, query,
  sort, timeframe, cursor; 1 credit). Captured twice (`subreddit-search`,
  `subreddit-search-page-2`, 2 credits): the answer is the same Reddit post
  shape as the keyword search, 7 posts a page, the cursor under `cursor`,
  `timeframe=month` ignored beside `sort=new` (page two reached back to May),
  and **no body**: `selftext` was empty on all 14 posts, where the keyword
  search and the subreddit feed carry it (7 of 7, 23 of 23). No identity
  survived the scrubber. Not wired into the connector yet: whether a
  title-only post is worth classifying is the owner's call.
