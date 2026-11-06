---
id: US-536
title: Subreddits are read in one search after the first poll
type: feature
priority: p1
created: 2026-11-06T23:02+08:00
parent:
area: engine
resolution:
---

## Context

ScrapeCreators bills one credit for each request, whatever the request
returns, and the Reddit connector reads each subreddit with its own request.
A poll therefore pays at least one credit for every subreddit, even when no
subreddit has a new post. A monitor with 9 subreddits that polls every hour
pays 216 credits a day ($0.41 at $1.88 per 1,000) before it finds one post.
On a hosted site in November 2026 that floor alone used most of a $0.50 daily
budget, and hourly polls on 2026-11-05 bought about 6 posts per credit.

The subreddit endpoint does not accept Reddit's `a+b+c` form: two calls on
2026-11-06 answered 404 "Subreddit not found" and charged nothing. The search
endpoint accepts `subreddit:a OR subreddit:b`. One call on 2026-11-06 for
shopify, ecommerce and smallbusiness, `sort=new`, returned 25 posts from all
three, back 10 hours, for one credit.

So a poll after a monitor's first reads its subreddits with one search, and
pays for one page plus one more for each 25 new posts. The first poll keeps
one request per subreddit, so a quiet subreddit still gets its own newest
posts in a monitor's first results. A first poll can have a `since` too
(`firstPollWindowDays`), so the connector cannot tell the two apart: the
caller says, with `combineChannels` on the request. The pipeline sets it
only when the application turns on `combineChannelsAfterFirstPoll`, so a
self-hosted instance reads as before until it chooses the trade.

The risk is coverage. Reddit's search can leave a post out. In the same call,
23 of the 24 posts that per-subreddit reads had stored for those 10 hours came
back; one r/shopify post did not, and the reason is not known. This ticket
measures the share over a longer window before it ships.

## Acceptance

- [x] A request with `combineChannels` and two or more subreddits reads them
      with one search request per group of up to ten: `query` is
      `subreddit:a OR subreddit:b …`, with `filter=posts` and `sort=new`.
- [x] A request without `combineChannels`, or with one subreddit, reads each
      subreddit with its own request, as before.
- [x] A walk already inside one channel mode finishes in it, whatever a
      resumed request asks.
- [x] The pipeline sets `combineChannels` on a poll after the first when
      `combineChannelsAfterFirstPoll` is on, and on a first poll when
      `combineChannelsOnFirstPoll` is on. Unset, it never does.
- [x] Each post from a combined read carries `foundBy` with the monitor's own
      subreddit text for the post's subreddit, matched without case. A post
      from a subreddit the monitor did not name is dropped. The pipeline
      records that per-post input.
- [x] A combined read stops at the first post at or before `since`, and its
      page cap is the per-input cap times the subreddits in its group.
- [x] The parser test reads a captured combined search page, not a written one.
- [ ] One comparison over at least 24 hours of posts gives the share of
      per-subreddit posts that the combined search misses, written in the Log.
- [ ] The owner accepts that share before a release carries the change.

## Notes

- Connector: `packages/engine/src/sources/providers/scrapecreators/reddit.ts`.
  The cursor's `phase` gains a value for the combined read.
- The collector keeps a post's own `foundBy` when the page has none
  (`packages/pipeline/src/worker/collect.ts`), so no pipeline change.
- Group size: at most 10 names a search (`subredditsPerSearch`). The search
  length limit is not measured; 9 names, 232 characters, were accepted.
- SocialCrawl's Reddit connector is out of scope.

## Log

- 2026-11-06T23:02+08:00 — Ticket written from the 2026-11-06 probes: two
  404s at 0 credits on `r/a+b+c`, one combined search at 1 credit.
- 2026-11-06T23:04+08:00 — Coverage, first window. One combined search for
  9 subreddits (query 232 characters, accepted) read 8 pages, 8 credits, 200
  posts (197 distinct: pages overlap by a few) back to 2026-11-05 10:16 UTC.
  Per-subreddit reads had stored 191 posts from those 9 between 10:16 and
  2026-11-06 14:00 UTC; the search had 179 of them and missed 12 (6%):
  8 smallbusiness, 2 Ebay, 1 shopify, 1 EntrepreneurRideAlong. None of the
  12 had a match. Two of them are the same "[FOR HIRE]" post twice, which
  looks like removed spam, but reddit.com answered 403 to a by-id read, so the
  cause is not known. At about 7 new posts an hour across the 9, an hourly
  poll would pay about 1 credit instead of 9.
- 2026-11-06T23:13+08:00 — Why the 12 were missed. By post age: 10 of 102
  posts 16–29 hours old, 1 of 52 at 8–16 hours, 1 of 37 at 1–8 hours. Then
  one per-subreddit read of r/smallbusiness back to 2026-11-05 00:47 UTC
  (4 pages, 4 credits, 100 posts): 7 of its 8 missed posts are gone from the
  subreddit's own newest list too, so Reddit removed them after we stored
  them, and a per-subreddit read made now would miss them as well. One
  (t3_1xon1a1) is in the list and not in the search: a real skip. So 1 of 8
  checked misses is the search's fault; the other 4 (2 Ebay, 1 shopify,
  1 EntrepreneurRideAlong) are not checked. The search skips between 1 and 5
  of 184 posts that were not removed, about 0.5% to 3%.
- 2026-11-06T23:22+08:00 — Built. The connector takes `combineChannels`; the
  pipeline sends it on later polls when `combineChannelsAfterFirstPoll` is on.
  Fixture captured with `capture.mjs --only=subreddits-combined`, 2 credits:
  softwaretesting, QualityAssurance, ExperiencedDevs, two pages of 25. The
  first capture held an email address in a post body; the scrubber now
  replaces addresses in every string, and a second capture (2 more credits)
  replaced the files. Lint, typecheck and the full suite pass. Not yet run
  against a live poll.
- 2026-11-06T23:42+08:00 — Released in 0.26.4. Then the owner asked to
  combine first polls too, to save on BuyerFinder's free searches, without
  the first-poll measurement. Added `combineChannelsOnFirstPoll`, a separate
  option, so a caller can take the first-poll trade or leave it.
