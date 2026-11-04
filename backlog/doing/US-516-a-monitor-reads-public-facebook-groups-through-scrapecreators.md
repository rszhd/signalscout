---
id: US-516
title: A monitor reads public Facebook groups through ScrapeCreators
type: feature
priority: p2
created: 2026-11-04T13:35+08:00
parent:
area: sources
resolution:
---

## Context

Two applications on these packages (BuyerFinder, and the Radar page) asked
for Facebook groups. Their buyers ask in product owner groups the same way
they ask on forums.

**Facebook is an eighth network.** PLAN.md says no new network until Reddit
and X reliably give useful matches. The owner decided on 2026-11-04 to cross
the rule, as US-028, US-034, US-044, US-049 and US-470 did. This ticket
records the exception.

**Public groups only.** Meta removed the Groups API in April 2024. A private
group needs a member's session cookies, and that is not this ticket.
ScrapeCreators' `/v1/facebook/group/posts` reads a public group without a
login, through the key a monitor already has for Reddit, TikTok and YouTube.

**A group's queries are addresses.** No provider searches Facebook groups by
keyword. A monitor names the groups to read, so the platform declares
`search.input: "address"`, as `forum` does (US-470), and each query is a
group's `https://www.facebook.com/groups/<id or name>/` address.

**The read pages back to `since`, with a cap.** One credit buys one page of 3
or 4 posts. `sort_by=CHRONOLOGICAL` can put an older post above newer ones:
a group's top post came first on its page, and newer posts followed it
(Log). So one old post does not end the read. The read stops on the first
page whose posts are all older than `since`, or on a page cap. It keeps each
post newer than `since` on every page it reads, and drops a post id it has
already returned in the same read.
A post with no text is a photo or a video and has nothing to score: it is
skipped.

## Acceptance

- [x] `facebook` is a platform; `posts.source` accepts it, with its
      migration.
- [x] The platform declares address queries, and `searchQuerySchemaFor`
      holds each one to an `https://www.facebook.com/groups/` address.
- [x] The connector reads a group's posts by the rule above and returns each
      post with its group as the channel. Its id is the Facebook post id.
- [x] A page with an older post above newer ones does not stop the read: a
      test replays such a page and gets the newer posts, and the next page
      is read.
- [x] Pages a group a poll are capped (default 5), and an application can
      set a lower cap; the price estimate uses the cap.
- [x] Each page is one unit, counted from `credits_charged`.
- [x] A private or missing group is skipped with a log line naming the
      address, and the other groups in the poll still run.
- [x] Tests replay captured pages through a fake ScrapeCreators; no test
      fetches.

## Notes

**Probe pages.** The five groups in the Log. Capture fixtures again with the
connector's own request; the probe ran from a scratch script.

**Open decision: a post time older than its place.** In the buy/sell group,
post ids went down in strict order, but some post times did not: two posts
added among others on 2026-11-04 carried times of 2026-10-25 and 2026-10-27.
A read by post time drops such a post; a read by the last post id seen keeps
it. The owner decides when more groups are read (2026-11-04). Until then
the read uses post time, as every other connector does.

**Author names.** Each post carries the author's name and id. The connector
keeps them as every other platform does. An application that must not show
names (Radar) hides them itself.

**Comments.** Each post carries up to about 7 `topComments`. This ticket
reads posts only. Replies are a later ticket, as US-020 was for Reddit.

**Cost, as an estimate.** Owner groups gave 2 to 4 posts a day, so one page
a group a poll is the normal case: about 1 credit ($0.00188) a group a poll.
Measured on 5 groups on one day only.

**The applications need their own tickets:** a list of groups for each niche
(web search found only 6 coffee groups, so finding groups is the slow part),
and on Radar, hiding author names. The hosted repository is retired
(2026-11-03), so it has no cloud impact.

## Log

- 2026-11-04T13:12+08:00 — Probe, from a scratch script, 7 credits in all.
  Five public coffee groups, one day back: Sage Espresso/Coffee Machine Owners
  Group UK (856491544939621), GAGGIA Classic (562488620537786), Moccamaster
  Owners (368636185912694), Ninja Luxe Café Enthusiasts
  (ninjaespressoenthusiasts) and Coffee Machine Buy/Sell (1280345455996699).
  All five read without a login, 3 or 4 posts a credit, 25 posts. The four
  owner groups had 2 to 4 posts a day each, mostly repair and setup
  questions; 3 or 4 of about 18 asked what to buy (cleaning tablets, a
  replacement boiler wire, a pump that fits, "is it just a gimmick").
  The buy/sell group held only sellers' ads. In that group, page 2 had a
  newer oldest post than page 1, so the sort is not strict.
- 2026-11-04T13:35+08:00 — Written, on the owner's decision to add public
  groups.
- 2026-11-04T13:42+08:00 — The probe pages, read again, show two kinds of
  disorder. Ninja Luxe Café's page 1: an admin welcome post (3 Nov 13:04),
  then a post from 1 Nov 11:54 with 31 comments, then 2 Nov 20:12 and
  2 Nov 13:21. The other three owner groups were newest first. The buy/sell
  group's post ids fell in strict order over three pages while its times did
  not (Notes). The owner chose to handle the top post now and decide the
  post-time question when more groups are read.
- 2026-11-04T13:48+08:00 — Started. The posts with an old time in the
  buy/sell group all carry `shared_post_id`: they are shares, and
  `publishTime` and `creation_time` both give the shared post's time.
  `facebook-fixtures/capture.mjs` captured the fixtures, 4 credits a run,
  run twice: the first run's scrubber left fbcdn addresses inside arrays and
  about 250 member names in the Ninja group's welcome post, so the scrubber
  now walks arrays and replaces a list of name lines, and the second run is
  the one committed. Answers: a page is 3 or 4 posts for 1 credit; page two
  repeated nothing of page one; a missing group answers 500 "This Facebook
  group isn't available. It may not exist or may require logging in." and
  bills 0; `groups/baristahustle` answered 200 with no posts and a null
  cursor, and billed 1; a refused key answers 401 and bills 0. No group
  known to be private was captured; the 500 message names both cases.
  `topComments` held 2 of a post's 9 comments, so it is not the thread.
- 2026-11-04T14:00+08:00 — Built. `facebook` platform with
  `search.input: "address"` and a new `addressPrefix`, so
  `searchQuerySchemaFor` refuses an address outside
  `https://www.facebook.com/groups/`. Migration 0077 adds `facebook` to the
  six source constraints. `ScrapeCreatorsFacebookSource`: one page a call,
  the cursor carries the group, the pages read and the post ids already
  returned; `createScrapeCreatorsFacebook({ pagesPerGroup })` takes 1 to 5.
  A 500 naming "isn't available" bills 0 and skips the group with a
  warning; any other provider error throws. 15 connector tests replay the
  captured pages, and 2 query tests check the prefix. Six existing tests in
  `apps/api/src/monitors.test.ts` changed with the behaviour (an eighth platform in two lists, an empty
  `facebook` query list on a monitor). AGENTS.md and PLAN.md name the eighth
  platform and the sixth crossing; the keys page names the provider. Root
  lint, type check and `pnpm test` (2,821) pass. Not run live through the
  pipeline yet, and `packages/ui` has no label or icon for it (nor for
  forums).
