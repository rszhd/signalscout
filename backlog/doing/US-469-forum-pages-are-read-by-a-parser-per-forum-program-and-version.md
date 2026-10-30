---
id: US-469
title: Forum pages are read by a parser per forum program and version
type: feature
priority: p2
created: 2026-10-30T11:36+08:00
parent:
area: sources
resolution:
---

## Context

An application on these packages (US-466 in its own repository) will read
niche forums. No platform here reads a forum yet. This ticket is the first
half: reading a forum's pages. The connector, the platform entry and the
migration come after it.

**One parser per forum program and version, chosen by the page.** Forum
software comes in many programs, each with versions whose pages differ:
XenForo 1 and XenForo 2 share almost no markup. Most of them have no public
API (phpBB, SMF, MyBB, XenForo 1, vBulletin 3/4), and the ones that do need a
key the forum's own admin makes (XenForo 2, Invision, vBulletin 5). Discourse,
Flarum and NodeBB answer JSON without a key and will be read that way. The
owner chose parsers over reading titles only: a page no parser knows is
reported as unknown, with what was detected, and that parser is built next.

**Order: the most used programs first.** Trackers disagree, but XenForo and
phpBB rank high in each one that counts sites: XenForo 1 and 2, phpBB 3,
Discourse, vBulletin, SMF, then MyBB, Invision, Flarum and bbPress.

**What a parser reads.** From a "newest threads" list: each thread's id,
address, title, start time, last activity time and whether it is pinned. From
a thread: its title, the first post's text and its time. Every list starts
with pinned threads, and phpBB cannot sort by start time, only by last post,
so a read keeps the threads started after the last read and stops paging when
the newest activity on a page (pinned threads left out) is older than it.

## Acceptance

- [x] `detectForum` names the program and version of a page, or says
      unknown.
- [x] XenForo 1 and phpBB 3: a list parser and a thread parser, tested on
      captured pages.
- [x] Addresses come back absolute and without the forum's session id
      (`sid`, `PHPSESSID`, `s`).
- [x] Pinned threads are marked.
- [ ] The rest of the order above, one program at a time, each with captured
      pages. Programs behind a bot check wait for a provider that passes it.

## Notes

Captures: `packages/engine/src/sources/forums/fixtures/capture.mjs`, plain
requests, no cost. It scrubs usernames (profile links, `data-author`, in any
letter case, and names a forum shortened in a link's text), avatar paths that
carry a member id or a Gravatar hash, and signatures.

## Log

- 2026-10-30T11:36+08:00 — Written. Captured XenForo 1 (Digital Point,
  content creation, sorted by start) and phpBB 3 (Gentoo, installing Gentoo,
  sorted by last post). The scrubber needed four fixes before nothing
  identifying was left: Gravatar hashes, avatar ids in two path forms, a
  signature link naming a user, and that user's name in another case and cut
  short.
- 2026-10-30T11:43+08:00 — XenForo 1 and phpBB 3 read. Both lists give all 50
  threads with a start and a last-activity time; phpBB marks its one pinned
  thread. XenForo 1 writes a recent time as `data-time` and an older one in
  words, sometimes with no hour ("Mar 3, 2011"), read as UTC. phpBB's thread
  parser stops before the replies. No DOM library: each parser cuts at its
  program's markers. 13 tests; root `pnpm typecheck`, `pnpm lint` and
  `pnpm test` (2,625 tests) pass. `biome.json` now skips the HTML fixtures,
  as it skips the JSON ones.
- 2026-10-30T11:48+08:00 — Discourse read through its JSON (meta.discourse.org,
  support category, by start time): 30 topics with both times, and the first
  post of one topic. A program interface gains `threadPageUrl`, where to fetch
  a thread when that is not its own address. The capture keeps only a
  Discourse section page's `<head>`: the body carries every poster's name in
  avatar addresses and preloaded JSON. The JSON scrubber treats `name` as a
  person's only on a member object; a first version replaced category names
  too. No pinned topic on that list, so pinned is not yet seen on a capture.
  17 forum tests; root lint, type check and `pnpm test` (2,629) pass.
- 2026-10-30T11:52+08:00 — SMF 2.0.15 read (Geekhack, keyboards board, by
  first post): 50 topics, 14 pinned, every last-post date; the list shows no
  start time, so `startedAt` is null and the thread page gives it. SMF writes
  dates in words in the admin's format, so `fromEnglishDate` now reads them
  for every program: day or month first, "at" or a comma before the time,
  12 or 24 hours, "Today" and "Yesterday" from the fetch time, all as UTC;
  XenForo 1 uses it too. A date in another language comes back null. SMF's
  session id is not hex, so the scrubber's pattern widened. 28 forum tests;
  root lint, type check and `pnpm test` (2,640) pass.
- 2026-10-30T11:55+08:00 — Plain requests stop here. MacRumors (XenForo 2.3)
  answered a browser-like Python request but gave Node's fetch a 403, and
  Head-Fi served its own bot challenge; trying other clients or headers to
  pass a check is not done here. The owner: "lets do everything using
  BrightData". The capture script now fetches only through Bright Data's Web
  Unlocker (`POST https://api.brightdata.com/request`, `{zone, url, format:
  "raw"}`, read from its docs), with `BRIGHTDATA_API_KEY` and
  `BRIGHTDATA_UNLOCKER_ZONE` from the environment, and prints its request
  count. New targets: XenForo 2 (MacRumors), vBulletin, Invision and MyBB;
  the last three save their lists only, to write their pickers from. Waiting
  for a key: none is in a local `.env`.
- 2026-10-30T12:07+08:00 — First Bright Data captures, zone `web_unlocker1`:
  12 requests in all, inside the free monthly 5,000. XenForo 2.3
  (MacRumors, iMac) and vBulletin 5 (vBulletin's own forum) came through and
  are read: XenForo 2 has every time in `data-timestamp`; vBulletin 5 lists
  its start only in words, which read 8 hours early as UTC against the
  thread's `<time>`, so list entries now carry `approximateStart`, and
  `fromEnglishDate` reads "'26" years. Two refusals worth knowing: MyBB's
  own community answered Bright Data with a "Please refresh to continue"
  challenge, and invisioncommunity.com was refused by Bright Data itself,
  "not available for immediate residential (no KYC) access mode in
  accordance with robots.txt"; full access needs Bright Data's KYC form,
  the owner's call. Three requests were wasted on old targets when a failed
  edit was followed by a run. Scrubber additions: vBulletin `/member/<id>-`
  links, `data-vbnamecard`, avatar file ids, MyBB profile links, and every
  email address (MacRumors' footer named staff). 34 forum tests; root lint,
  type check and `pnpm test` (2,646) pass.
- 2026-10-30T15:01+08:00 — bbPress read (wordpress.org support, How-to and
  Troubleshooting): 33 topics, 3 pinned; the list has no start time and its
  freshness is "15 hours, 10 minutes ago", read by a new `fromAgo` with no
  zone to guess; the topic page's `article:published_time` is exact. Flarum's
  API was refused by Bright Data like Invision (no KYC, robots.txt), and the
  capture stopped without saving. Scrubber additions: bbPress `/users/<name>/`
  links and their names, the author line, `user-id-<n>` row classes,
  profiles.wordpress.org, and 64-digit Gravatar hashes. A server path in the
  captured post's own text, `/bernatu/www/`, may hold part of its writer's
  account name; no general rule reaches it and the page is not edited by
  hand. About 22 Bright Data requests used so far. 38 forum tests; root
  lint, type check and `pnpm test` (2,650) pass.
- 2026-10-30T15:08+08:00 — MyBB read on Kodi's forum (Android support,
  sorted by start), which Bright Data passed where MyBB's own community
  did not. Kodi restyles MyBB into `<div>` rows; the parser keys on two
  template markers both themes keep, the title's `id="tid_<id>"` and the
  row's `forumdisplay_sticky`/`forumdisplay_regular`. 20 threads, 5 pinned;
  dates are words ("2026-10-17, 08:57"), so starts are approximate and
  `fromEnglishDate` reads year-month-day. Two category pages were captured
  first (a category lists no threads) and removed. Scrubber: MyBB
  `avatars/avatar_<uid>`. 42 forum tests; root lint, type check and
  `pnpm test` (2,654) pass. About 30 Bright Data requests used.
