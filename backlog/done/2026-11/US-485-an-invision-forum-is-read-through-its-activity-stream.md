---
id: US-485
title: An Invision forum is read through its activity stream
type: feature
priority: p2
created: 2026-11-01T02:34+08:00
resolution: shipped
parent: US-473
area: pipeline
---

## Context

A scan reads a whole forum through its newest-threads feed (US-473).
Invision Community has no such feed. Its RSS (`/discover/all.xml/`) is the
"All Activity" stream, and on LinusTechTips all 25 of its items were replies,
which the feed reader takes for 25 new threads. Its topic search needs a
search term. Only one board of nine had a "recent topics" stream of its
own. Invision is the largest program the survey found with no reader (11
forums of 287).

The HTML stream at `/discover/` lists new topics among the replies. Probed
through the browser on 2026-11-01: 9 of 11 boards opened it; 4 of the 9 run
Invision 5. One page holds 25 to 40 items and covers 20 minutes on a busy
board (stripersonline) to several days on a quiet one. New topics are few:
about 10 among some 400 items. "Load more" asks for
`<stream address>?before=<data-timestamp of the last item>`, and that
address opens as a full page (checked on LinusTechTips and StereoNET).

The owner chose this approach over section pages. An Invision 4 section
reader exists (`invision4.ts`); Invision 5 has no reader at all.

## Acceptance

- [x] An Invision 4 or 5 home page gives the forum's `/discover/` address as
      its newest-threads address, in the board's own folder
      (`/forums/discover/` where the board lives in `/forums/`).
- [x] A stream reader for Invision 4 and for Invision 5 returns the new
      topics only, each with its topic address, title, start time and the
      text the item shows; replies are dropped by a rule that reads no
      words in the board's language.
- [x] A poll reads older pages with `?before=` until it passes the last
      poll's time or reaches a page cap, and reports how many pages it read.
- [x] A new topic whose text the stream cuts is completed from its thread
      page; an Invision 5 thread page is read too.
- [x] Fixtures for both versions are captured through the browser, names
      scrubbed: a stream page, a second page, a thread page.
- [x] A live poll of one Invision 4 and one Invision 5 board finds new
      topics, with the units it spent in the Log.

## Notes

- Saved pages and probe results: `forum-survey/invision-probe/` beside the
  repositories (`<host>.html`, `-page2.html`, `-all.xml.txt`,
  `results.json`). The stream script read for the `?before=` rule:
  `invision-probe/js/ltt-streams.js`.
- Invision 4 items: `<li class="ipsStreamItem ..." data-role="activityItem"
  data-timestamp="<unix>">`; Invision 5 items: `ipsStreamItem__*` classes,
  the body tag carries `data-ips-hook`.
- A new-topic item carries a reply link too (its last post), so "no
  `?do=findComment` link" is not the rule; the item's own title link is.
- On page 2, some items were newer than `before` (2 of 26 on
  LinusTechTips, 10 of 35 on StereoNET). Find out why before trusting the
  stop rule; deduplication by topic id keeps them harmless.
- The page cap's value is the owner's to set at build time.
- StereoNET's `/discover/all.xml/` failed through the browser, then Bright
  Data refused it without KYC; its `/discover/` pages opened.

## Log
- 2026-11-01T02:50+08:00 — Owner set the page cap: 5 stream pages a poll.
  Fixtures captured through the browser (`--pages=stream`): LinusTechTips
  (Invision 4, replies only on both pages), MyGolfSpy (Invision 4, 1 and 3
  new topics, and a thread), GolfWRX (Invision 5, 1 and 5 new topics, a
  thread, its home page), StereoNET's home page (Invision 5 in `/forums/`).
  About 23 browser pages over four runs, under $0.03: GolfWRX once came
  back cut after its head, and two scrubber gaps were fixed and captured
  again (a photo-only profile link, a mention turned into text, and a
  member-named photo file in JSON-LD). New-topic rule: an item's status
  line names one member (`data-ipshover` links), a reply's names two; it
  agreed with the words "posted a topic" on all 142 topic items.
- 2026-11-01T03:03+08:00 — Built (057dd40, written by DeepSeek Flash from a
  brief, reviewed): `invision-stream.ts` reads the stream for both versions,
  `invision5.ts` reads Invision 5 threads and home pages, and the connector
  follows `?before=` through its cursor. Pages read are told one page event
  each; the cursor counts them against the cap. 2,776 tests pass. Live poll,
  3-hour window, browser first: MyGolfSpy (Invision 4) read 2 pages and
  stopped past the window, 1 new topic; GolfWRX (Invision 5) read 5 pages and
  stopped at the cap, 15 new topics, all distinct. 2 + 1 posts completed from
  their thread pages, whole. 24 units in all: each stream page is 2 units,
  because each call starts its own browser. Reading several pages in one call
  would halve that; not done here.
