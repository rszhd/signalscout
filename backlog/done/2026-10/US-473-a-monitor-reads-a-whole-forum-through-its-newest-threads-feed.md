---
id: US-473
title: A monitor reads a whole forum through its newest-threads feed
type: feature
priority: p2
created: 2026-10-31T12:04+08:00
parent: US-470
area: sources
resolution: shipped
---

## Context

US-470 reads forum sections, and a model names them. A BuyerFinder scan on
2026-10-31 kept one of five named sections: two were invented addresses, one
was a bot check, one a page no parser knew. Reading the sections from a
forum's home page does not fix it: a home page may show only some of them
(MacRumors' shows 12), and deeper ones sit on their parent's page.

**The owner chose to read each forum's newest threads directly.** Most forum
programs publish a feed of the newest threads across the whole forum. A probe
of one forum per program on 2026-10-31 (13 requests) found one for each
program but Invision:

| Program | Feed | Items | Text |
|---|---|---|---|
| XenForo 1 and 2 | `forums/-/index.rss` | 50 | cut |
| phpBB 3 | `app.php/feed/topics` | 10 | full |
| vBulletin 3/4 | `external.php?type=RSS2` | 15 | cut |
| vBulletin 5 | `external?type=rss2` | 30 | full |
| SMF 2 | `index.php?action=.xml;type=rss2;sa=news` | 5 | cut |
| MyBB | `syndication.php` | 15 | full |
| bbPress | `topics/feed/` | 10 | full |
| Discourse | `latest.json?order=created` | 30 | none |

A feed with the full text is the posts themselves: one request for up to 50,
where a section costs a request for each thread it opens. Where the text is
cut, each new thread's page is read, as a section's are. Seven of nine home
pages name their feed in a `<link rel="alternate">`; MacRumors does not.
The SMF and bbPress feeds a home page names hold replies too, so the topics
feeds are the ones read.

A busy forum fills its feed fast: MacRumors' 50 items covered 1.5 hours. A
poll reads what the feed shows.

## Acceptance

- [x] A forum's home page names its program, also where `detect` needs a list
      or a thread page: phpBB, vBulletin 3/4 and 5, SMF, MyBB and Invision.
- [x] Each program but Invision gives its newest-threads feed from a home
      page: the topics feed the page names, or the program's usual address.
- [x] A forum query may be a feed address. Its items newer than the last
      poll become posts: from the feed where the program's feed holds the full
      text, from the thread's page where it is cut, at most the connector's
      thread limit a poll. Replies are never posts.
- [x] A feed post's id is the one a section read of the same thread gives,
      where the feed's link names the thread.
- [x] A section address still reads as before, so existing monitors keep
      working.
- [x] The page event says `feed`, and how many posts the feed gave.
- [x] Tests on captured feeds and home pages; no test fetches.

## Notes

Discourse's feed is its `latest.json`, which the section reader already
reads: it is a section at the forum's root. Invision has no feed by default;
its activity page met a bot check, so it waits for the browser fallback.

## Log
- 2026-10-31T12:15+08:00 — Built. One reader for RSS and Atom (`feeds.ts`);
  each program says its feed address, whether the feed holds the full post,
  and, for MyBB and vBulletin 5, the thread id in an item's link. Home pages
  of phpBB, vBulletin 3/4 and 5, SMF, MyBB and Invision are named by
  `detectIndex`. Captured: one home page and one feed per program (Bright
  Data, 37 requests over the probes and the captures, about $0.056). Three findings
  from the captures: Bright Data answered WebHostingTalk's feed with
  Chrome's XML viewer page, which keeps the feed whole in one element, so
  the reader takes it from there; XenForo 2's feed lists threads by their
  last reply, so a cut feed's thread page decides the start; the scrubber
  replaced the site's own account name ("MacRumors") inside every address,
  so a name that is a label of the page's host is now kept, and a member's
  self-introduction ("I'm <name> from") is replaced where it stands. Not yet
  run: a poll on a live feed.
- 2026-10-31T14:34+08:00 — A second local scan (vortexoptics.com) kept no
  forum. Two causes, both fixed: Bright Data answered Long Range Hunting's
  feed as Chrome's text view, the feed escaped inside a `<pre>`, a minute
  after answering it as it is, so the reader takes the feed out of that view
  too (the real answer reads 20 items); and The High Road names its feed
  `index.php?forums/-/index.rss`, which the XenForo rule refused for its
  path, so the guessed `/forums/-/index.rss` answered 404.
- 2026-10-31T15:06+08:00 — Third local scan (vortexoptics.com), with BUG-475
  and the fixes above: four of five forums kept (Long Range Hunting,
  AccurateShooter, BirdForum, The High Road; Sniper's Hide has no parser).
  The first poll read 4 feeds and 79 thread pages: 51 posts from three
  forums, none dropped by keywords, 28 past the embedding stage and triage,
  28 scored on the Claude bridge, no match: the threads were reloading,
  builds and introductions, not optics purchases. All 20 of The High Road's
  thread pages were skipped: XenForo 2's reader took a thread id from
  `/threads/` only, and the board writes `index.php?threads/`. Fixed.
- 2026-10-31T18:47+08:00 — Polled live through feeds in four local scans,
  the last with US-476: a feed is one request, and The High Road's
  `index.php?` feed and threads now read.
