---
id: US-138
title: SocialCrawl reads the comments under a Reddit post
type: feature
priority: p2
created: 2026-09-15T14:01+08:00
parent: US-020
area:
resolution: shipped
---

## Context

**This endpoint was measured, works, and was left unbuilt on price.** US-020
tested it on 2026-09-06 against the same r/webdev thread as ScrapeCreators:
92 comments of 95 claimed against 43, seven levels deep against three, one
call against three, and `data.truncated` saying when it stopped. It cost
$0.041 where ScrapeCreators cost $0.0056, and a subreddit poll's median thread
has about twelve comments, which ScrapeCreators returns whole for $0.00188.
The ticket wrote SocialCrawl down as the escape hatch and built nothing.

**The reason to build it now is not price.** An account that brings its own
SocialCrawl key and no ScrapeCreators key has Reddit posts and no Reddit
threads, and the form tells them so. Every other SocialCrawl platform reads
comments through the shared `comments.ts` parser. This is the one that does
not, and the parser already exists.

**Two facts the shared parser must not assume away**, both from the
measurement: this endpoint returns a comment without its parent post and with
`author.username` null, so the row must be joined to our own post and stored
with no author. And its envelope carries `truncated` where X's carries
`next_cursor`, so the shared parser's paging is not this endpoint's paging.

**The lent-keys plan does not use this.** US-134 names ScrapeCreators for
Reddit. This is for an account spending its own money at a provider it chose.

## Acceptance

- [x] `canFetchReplies: true` and `replyPricePerUnitMicros` at five credits,
      the measured price, on the definition and on the built instance
- [x] `fetchReplies` reads the thread by post URL through `comments.ts`,
      flattened depth first, and reads `truncated` as `partial` unless it says
      false. The author is present on every comment now; the parser still
      stores a comment without one, and the removed comment with no text is
      dropped and counted
- [x] The permalink is the provider's own, `.../comments/<post>/comment/<id>/`.
      The owner opened one on 2026-09-15 and it landed on the comment
- [x] The connector comment says what is true now: on, five credits a call,
      and the whole tree in that call; the form reads the price
- [x] The parser replays `reddit-fixtures/comments.json`, captured through a
      `--only=comments` mode. 5 credits, $0.04
- [x] The monitor form reads the declaration and the price through
      `canFetchRepliesFor` and `replyPricePerUnit`
- [x] No test spends money. 31 pass in the connector's file

## Notes

- Needs `SOCIALCRAWL_API_KEY` in `.env`. It is not on the development machine
  on the day this was written.
- The comment with a null author is a per-platform fact at this provider,
  not a schema fact. US-020's Notes record it. Do not "fix" the parser to
  require one.

## Log

- 2026-09-15T14:01+08:00 — Written. Fourth of five; blocked on a key.

- 2026-09-15T16:05+08:00 — **Built, 5 credits spent, one box open.** The
  endpoint answers differently from what US-020 measured on 2026-09-06, and
  the guide names a different primary source now. The whole tree arrived in
  one call — 34 comments for 34 claimed, nested under `replies`, `truncated:
  false`, no cursor — with an author and a permalink on every comment where
  US-020 saw null authors and no post. The connector flattens the tree depth
  first and rebuilds `t1_` and `t3_` from the bare ids, so the same comment
  through ScrapeCreators is one row.

  One row was a removed comment with no text and no author, listed anyway.
  The shared parser drops it, `itemsReturned` counts it, and the test names
  it, because two assertions were first written as 34 and the code was right.

  `Page` gained an optional `truncated`, filled by the client when the
  envelope carries one; nothing else reads it yet.

  Reported units: one per charged call, because `replyPricePerUnitMicros` is
  already the whole call's price. **Instagram's connector reports
  `creditsUsed` (5) against the same five-credit reply price**, which would
  record 25 credits a page; that is a separate bug and it is not fixed here.

- 2026-09-15T16:12+08:00 — **Closed.** The owner opened the provider's comment
  link and it landed on the comment. Every box is true. The Instagram
  over-report is BUG-020.
