---
id: US-442
title: SocialCrawl can browse a subreddit beside its keyword searches
type: feature
priority: p2
created: 2026-09-30T15:03+08:00
parent:
area: sources
resolution:
---

## Context

When a monitor names both keywords and subreddits, the SocialCrawl Reddit
connector runs one mode only: each keyword inside each subreddit
(`/v1/reddit/subreddit/search`). It never reads a subreddit's new posts, and
it never searches all of Reddit. The reason was measured in US-031: the
scoped search was on-topic where a search across Reddit was not.

A private experiment on these packages (US-434) moved its Reddit reads from
ScrapeCreators to SocialCrawl and got far fewer posts. On ScrapeCreators, the
subreddit browse gave most of the matches (four scans: 18, 170, 8 and 5
matches from the browse, against 2, 6, 1 and 0 from keywords). On SocialCrawl
a production scan read about three posts a page (50 posts from 18 pages),
where a browse page holds about 25.

An application with a classifier behind it may want the browse too. The
option adds it; the default stays the scoped mode alone.

## Acceptance

- [x] `createSocialCrawlReddit({ browseSubreddits: true })` returns the
      connector with the option; `socialCrawlReddit` is it with none, and
      behaves as before.
- [x] With the option and both keywords and subreddits, the walk reads each
      subreddit's new posts first, then every keyword inside every subreddit.
      It never searches all of Reddit.
- [x] A browsed post is found by the subreddit (`kind: "channel"`).
- [x] Tests cover the order, the discovery, and the factory; nothing reaches
      the network.
- [ ] One live scan with the option (BuyerFinder), and the Log gives posts
      and matches for browse and scoped searches.

## Notes

- `packages/engine/src/sources/providers/socialcrawl/reddit.ts`.
- The page cap is per input times the monitor's keywords plus subreddits,
  and a later poll reads the rest of a walk, so the option adds pages: about
  one per subreddit per page count.

## Log

- 2026-09-30 15:03 — Opened. The owner chose this over going back to
  ScrapeCreators, after BuyerFinder's subreddit searches came back thin.
- 2026-09-30 15:04 — Built. `createSocialCrawlReddit` and the options type are
  exported; `socialCrawlReddit` is the factory's with none. Three new tests in
  `reddit.test.ts` (31 pass); the engine suite passes (41 files, 822 tests),
  and lint and the type-check pass. BuyerFinder runs it against this working
  copy; not live yet.
