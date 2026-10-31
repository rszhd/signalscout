---
id: US-478
title: A forum no parser reads is read through the feed its home page names
type: feature
priority: p2
created: 2026-10-31T19:30+08:00
parent: US-473
area: sources
resolution:
---

## Context

A survey of 287 niche forums (BuyerFinder's US-466) found 62 on software no
parser reads, and the owner decided against a parser for one site's own
software. Three local scans on 2026-10-31 lost four of fifteen named forums
the same way. US-473 reads a forum through its newest-threads feed, and the
reader is the same for every program: what needs a program is finding the
feed and reading a thread's page where the feed cuts the text.

Six of these forums were checked on 2026-10-31: LowEndTalk and HeatingHelp
(Vanilla) and Mumsnet name a feed on their home page; 24hourcampfire
(UBB.threads), BoardGameGeek and PistonHeads do not. All three feeds hold
the whole post (median 700 to 1,000 characters, the longest several
thousand). The Vanilla feeds also list threads years old.

So a forum no parser knows, whose home page names a feed, is read through
that feed with no parser: its items are the posts as the feed gives them.

## Acceptance

- [ ] From a home page no program knows, `forumFeedFrom` gives the first
      feed the page names, with no program; a comments feed is passed over.
      With no feed named, it gives nothing, as before.
- [ ] A forum query that is a feed no program claims gives its new items as
      posts, the text as the feed gives it, with no page opened; their id is
      the item's address. Replies are never posts.
- [ ] A feed's item older than the poll's window is dropped, as for any
      feed, so the Vanilla feeds' old threads never reach the pipeline after
      the first poll.
- [ ] A known program's feed reads as before.
- [ ] Tests on the captured LowEndTalk and Mumsnet home pages and feeds;
      no test fetches.

## Notes

The captures are `nofeedparser-vanilla-*` and `nofeedparser-mumsnet-*`. The
scrubber learned Vanilla's `/profile/<name>` links and member photos for
them.

A feed with cut text and no program is read as it is: its page needs a
parser. BuyerFinder's scan check takes a forum with no program once this is
in (its `checkForums`).

## Log
