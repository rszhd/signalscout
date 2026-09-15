---
id: US-138
title: SocialCrawl reads the comments under a Reddit post
type: feature
priority: p2
created: 2026-09-15T14:01+08:00
parent: US-020
area:
resolution:
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

- [ ] `canFetchReplies: true` and `replyPricePerUnitMicros` at five credits,
      the measured price
- [ ] `fetchReplies` reads the thread by post URL through `comments.ts`, stores
      a comment with no author when the payload has none, and reads
      `truncated` as `partial`
- [ ] A permalink is built from the post URL and the comment id, and one was
      opened in a browser and reached the comment
- [ ] The connector comment that says why this was off is replaced by what
      is true now: it is on, it is five times the price, and the form's cost
      sentence says so
- [ ] The parser replays a captured fixture from
      `socialcrawl/reddit-fixtures/capture.mjs`, extended with a comments mode.
      5 credits, $0.04, or 0 if the provider's 300-second cache answers
- [ ] The monitor form's per-platform reply note reads the new declaration and
      the price
- [ ] No test spends money

## Notes

- Needs `SOCIALCRAWL_API_KEY` in `.env`. It is not on the development machine
  on the day this was written.
- The comment with a null author is a per-platform fact at this provider,
  not a schema fact. US-020's Notes record it. Do not "fix" the parser to
  require one.

## Log

- 2026-09-15T14:01+08:00 — Written. Fourth of five; blocked on a key.
