---
id: US-467
title: SocialCrawl's Reddit connector stops at posts it has already read
type: feature
priority: p2
created: 2026-10-30T10:32+08:00
parent: US-442
area: sources
resolution: shipped
---

## Context

A poll after the first one asks each input only for posts newer than the
last walk began (`since`, from `covered` in `pipeline/src/worker/collect.ts`).
The SocialCrawl Reddit connector drops the older posts from each page, but it
still buys the next page, up to the page cap. So a poll that asks for 4 pages
of a subreddit buys 4 pages every time, even when the first page already
reached posts it read last time.

The ScrapeCreators Reddit connector stops an input on a page where every post
is older than `since`. That still buys one page of old posts per input on
every poll.

This matters for a monitor that polls often. An application on these packages
(US-464 in its own repository) reads subreddits every hour with 4 pages an
input, so 100 new posts can be read in a busy hour. Without a stop it buys 4
pages an hour of each subreddit, whatever is new: about $117 a site a month at
SocialCrawl's credit price, against about $29 when a quiet hour buys one page.

**Every SocialCrawl Reddit endpoint this connector calls is asked for
`sort: "new"`, and every captured page is newest first**: `search-keyword`,
`search-keyword-page-2`, `subreddit-posts` and `subreddit-search` in
`reddit-fixtures/`. So on a page that holds a post at or before `since`, the
pages after it hold only older posts.

## Acceptance

- [x] With `since` set, an input stops on the first page that holds a post at
      or before `since`. The poll goes on to the next input, and to the next
      phase after the last input.
- [x] A page whose posts are all newer than `since` still leads to the next
      page, up to the cap.
- [x] Without `since` (a first poll with no window), nothing changes: each
      input reads up to its cap.
- [x] The posts on the stopping page that are newer than `since` are still
      returned.
- [x] Tests on the captured pages, with no fetch.

## Notes

The ScrapeCreators connector kept its own rule ("every post older"), which
buys one extra page. US-468 gave it the same rule as this one.

## Log

- 2026-10-30T10:32+08:00 — Written for US-464's hourly reads. The owner chose
  to keep SocialCrawl for Reddit and add the stop here, rather than move the
  hourly reads to ScrapeCreators.
- 2026-10-30T10:34+08:00 — Done. The input ends on a page where any post was
  dropped as older than `since`; the pages after it are not bought. Five tests
  on `search-keyword`: the stop, the move to the next input with no cursor,
  the next page while every post is new, a post at exactly `since` counted as
  read, and no change without `since`. Three of them failed before the change.
  Root `pnpm typecheck`, `pnpm lint` and `pnpm test` (2,610 tests) pass. Not
  run against SocialCrawl: the order claim rests on the four captured pages.
