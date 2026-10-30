---
id: US-468
title: ScrapeCreators' Reddit connector stops on the first page that reaches posts it has read
type: feature
priority: p2
created: 2026-10-30T10:48+08:00
parent: US-467
area: sources
resolution: shipped
---

## Context

The ScrapeCreators Reddit connector ends an input on a page where **every**
post is at or before `since`. In a poll where at least one post is new, the
first page holds new and old posts, so the connector buys a second page only
to find that it is all old. A monitor that polls every hour pays two pages per
input in most hours, where one is enough.

US-467 gave the SocialCrawl Reddit connector the tighter rule: end the input
on the first page that holds any post at or before `since`. It rests on the
order of the pages, and ScrapeCreators' pages are newest first too: every
endpoint is asked for `sort=new`, and the captured `search-posts`,
`search-posts-page-2`, `subreddit-posts`, `subreddit-search` and
`subreddit-search-page-2` are all newest first.

An application on these packages (US-464 in its own repository) reads 5
subreddits and 1 keyword every hour through ScrapeCreators: about $8 a site a
month with this rule, up to about $16 without it.

## Acceptance

- [x] With `since` set, an input stops on the first page that holds a post at
      or before `since`, and the poll goes on to the next input.
- [x] The new posts on that page are still returned.
- [x] A page whose posts are all newer than `since` still leads to the next
      page, up to the cap.
- [x] Without `since`, nothing changes.
- [x] Tests on the captured pages, with no fetch. The existing test that paged
      on with `since` inside the page changes, because the behaviour is meant
      to change: its `since` moves before the page.

## Notes

## Log

- 2026-10-30T10:48+08:00 — Written for US-464. The owner confirmed production
  reads Reddit through ScrapeCreators, and kept the keyword beside the 5
  subreddits.
- 2026-10-30T10:50+08:00 — Done. `reachedSince` is now "a post on this page
  was dropped as older", not "every post was". Two new tests on
  `subreddit-posts` (the stop, and the move to the next input); both failed
  before the change. "keeps the posts newer than `since` and pages on" moved
  its `since` from inside the page to before it, because that page now stops.
  Root `pnpm typecheck`, `pnpm lint` and `pnpm test` (2,612 tests) pass. Not
  run against ScrapeCreators: the order claim rests on the five captured
  pages.
