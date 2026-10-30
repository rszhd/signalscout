---
id: US-470
title: A monitor reads forum sections through Bright Data
type: feature
priority: p2
created: 2026-10-30T15:28+08:00
parent: US-469
area: sources
resolution:
---

## Context

US-469 reads forum pages: a parser per program and version, picked by the
page. This ticket makes a forum a platform a monitor can watch, fetched
through Bright Data's Web Unlocker, which passes the bot checks most forums
put in front of a plain request (US-469's Log).

**Forums are a seventh network.** PLAN.md says no new network until Reddit and
X reliably give useful matches. An application on these packages (US-466 in
its own repository) asked for forums, and its owner decided to cross the rule,
as US-028, US-034, US-044 and US-049 did. This ticket records the exception.

**A forum's queries are section addresses.** The pipeline hands every
connector the monitor's subreddits as its channels, so a forum cannot keep its
sections there. Each platform already keeps a list of its own in
`generated_queries`, and a forum has no keyword search. So a platform may
declare that its queries are addresses (`search.input: "address"`), and
`searchQuerySchemaFor` then holds each to a web address instead of a phrase.
Nothing in the poll changes, and only `posts.source` needs a migration.

**One request per section a poll, and one per new thread.** A section's
address is its newest-threads list (an application stores
`newestThreadsUrl`). The page names its program. The read keeps threads that
are not pinned and started after `since`, with a day's margin when the start
was read from words (`approximateStart`), and opens a thread whose start the
list does not show when its last activity is newer than `since`. Each kept
thread is opened for its first post, a few at a time through the cursor. One
list page a poll: a section with more new threads in an hour than one page
shows loses the rest, which hourly polls make rare.

**A page no parser knows is skipped, and logged** with its address, so the
next parser to build is the one somebody needs.

## Acceptance

- [x] `forum` is a platform; `posts.source` accepts it, with its migration.
- [x] A platform can declare address queries, and every check of a query
      (`searchQuerySchemaFor`) holds a forum's to an `https` address.
- [x] Bright Data's provider asks for an unlocker zone beside its key
      (`BRIGHTDATA_UNLOCKER_ZONE`), and `.env.example` says so.
- [x] The connector reads a section's list, keeps and opens threads by the
      rule above, and returns each first post with its forum as the channel.
      Its id is the forum's host and thread id, so two forums never share one.
- [x] A date read from words reaches the post as approximate.
- [x] Each request is one unit at Bright Data's price; a refusal answered as
      a 200 ("Residential Failed", a challenge page) bills nothing and skips
      the section with a log line.
- [x] A page no parser knows is skipped with a log line naming the address.
- [x] Tests replay captured pages through a fake Bright Data; no test fetches.

## Notes

**Cloud impact, for the owner.** The hosted application takes these packages
by version. On the version carrying this, Forums appears among its
platforms, and it has no Bright Data key; a monitor ticking Forums would be
refused for the missing key. Flagged, not handled here.

**Live once, outside the pipeline.** One walk on 2026-10-30 (Log), not a poll
through the worker; the cost ledger and `source_continuations` have not seen
a forum yet.

## Log

- 2026-10-30T15:28+08:00 — Written. The design keeps sections in the
  platform's own query list after reading `collect.ts`: its channels are
  `generated_subreddits` for every platform.
- 2026-10-30T15:37+08:00 — Built. `forum` platform with `search.input:
  "address"`; `searchQuerySchemaFor` holds such queries to an https address,
  so the API's monitor routes, its cost test and query generation all accept
  them. Migration 0075 adds `forum` to six source constraints. Bright Data's
  provider asks for `unlockerZone` (`BRIGHTDATA_UNLOCKER_ZONE`), redacted in
  logs like every credential field; `.env.example`, the compose file and the
  generated configuration page carry it. `BrightDataForumSource`: one list
  per call, then 5 threads a call through the cursor, at most 20 a section a
  poll; a refusal bills 0, an unknown page bills 1, a 429 waits in place.
  Thread parsers now say when their time came from words, and the post is
  marked approximate. 11 connector tests; removing the pinned rule fails two
  of them. Six existing tests changed with the behaviour (a seventh platform
  in lists, an empty `forum` query list on a monitor, Bright Data's two
  fields). AGENTS.md and PLAN.md name the seventh platform and the fifth
  crossing of the rule. Root lint, type check and `pnpm test` (2,665) pass.
- 2026-10-30T15:40+08:00 — First live walk, from a scratch script through
  the connector itself: MacRumors' iMac section, `since` 72 hours back.
  3 requests: the list, then 2 threads. "M6 iMac" came back as a post with
  its exact time; the other thread's answer was a page no parser read. The
  same thread, fetched again, read fine, so that first answer was something
  other than the thread. The skip log lines now carry the page's title and
  size. A thread lost this way is not retried: a later `since` passes it by.
  About 40 Bright Data requests used in all.
- 2026-10-30T15:52+08:00 — For US-466: `createBrightDataForum({ threadsPerSection })`
  lets an application open fewer threads a section a poll, and prices its
  cap to match; 20 stays the default. A free public scan of five sections
  at 20 each could open 100 threads. `fetchThroughUnlocker` is exported, so
  an application checks a section's address with the same request.
  12 connector tests; root `pnpm test` (2,666) passes.
