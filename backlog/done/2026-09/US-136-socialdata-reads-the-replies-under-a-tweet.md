---
id: US-136
title: SocialData reads the replies under a tweet
type: feature
priority: p1
created: 2026-09-15T13:59+08:00
parent: US-020
area:
resolution: shipped
---

## Context

**This is the connector the lent-keys plan fetches X through, and it returns
no replies.** US-134 names SocialData for X, because a tweet through it costs
half of what SocialCrawl charges. SocialCrawl's X connector reads replies and
has since US-020; SocialData's declares `canFetchReplies: false`, with a
comment saying nobody has measured the endpoint.

**Two things are unmeasured, and the connector comment names both.** What the
comment endpoint costs — SocialData bills per tweet returned, and whether a
reply is a tweet at that price or something else is not in our notes — and
whether the links it returns open the reply. US-047's rule is that a match
needs a URL that opens the thing it names, and an X reply URL is
`x.com/<handle>/status/<id>`, which the connector can build only if the payload
carries the handle.

**SocialData is prepaid, and an empty balance answers 402.** docs/sources.md
records it. A reply walk that reads a thread a page at a time will meet that
answer mid-thread, and it must stop the walk rather than be retried.

## Acceptance

- [x] The catalogue price is read and recorded in docs/costs.md: $0.0002 a
      row, the tweet price, so no `replyPricePerUnitMicros` is declared and
      the row count is the bill. Measured: eleven rows moved the balance
      $0.0022
- [x] `fetchReplies` reads one page of replies by tweet id, and pages on
      `next_cursor`
- [x] A reply's id is the tweet id, its parent post is the tweet the caller
      asked about, and `in_reply_to_status_id_str` is the parent reply when it
      names one — six of the ten captured replies hang under other replies
- [x] A permalink is built from the payload's handle and id. The owner opened
      one on 2026-09-15 and it landed on the reply
- [x] A 402 mid-thread is thrown, once, with the provider's repair in the
      message, and never retried. It ends the replies step the way it ends a
      search, and the thread is re-opened next poll because its row was never
      marked. Amended from "ends the walk with `partial: true`": catching it in
      the connector would let the step go on to the next thread and meet the
      same answer once per thread
- [x] The parser replays a captured fixture: one thread claiming 150 replies,
      two pages, every handle pseudonymised. Captured 2026-09-15, $0.0066
- [x] The monitor form reads the declaration through `canFetchRepliesFor`
- [x] No test spends money. 41 pass in the connector's file

## Notes

- `socialcrawl/x.ts`, `fetchReplies`, is the shape on the same platform. The
  two connectors must agree about the id they give a reply, or the same reply
  becomes two rows when an account switches provider.
- Needs `SOCIALDATA_API_KEY` in `.env`. It is not on the development machine
  on the day this was written.
- US-020 measured an X thread at SocialCrawl whose `has_more: true` led to
  nothing. Ask this provider the same question in the capture.

## Log

- 2026-09-15T13:59+08:00 — Written. Second of five; blocked on a key.

- 2026-09-15T14:45+08:00 — **Built, $0.0066 spent, one box open.** Four things
  measured that the ticket did not predict.

  The page is the whole conversation, root tweet included, as the last row and
  billed like the rest. The connector drops it by id and counts it in the bill.

  Eleven rows came back for a tweet claiming 150. Nothing says which claim is
  right, so `partial` is whether a cursor remains, and nothing else.

  Page two was the root tweet alone, $0.0002, with a cursor still offered.
  A page that yields nothing new ends the walk whatever the cursor says.

  The page is newest first, measured across all eleven, so a page entirely
  older than `since` ends the walk — the one thing three LinkedIn connectors
  could not do, and this one can on replies as on search.

  The empty-thread question, BUG-007's, went unanswered: every tweet the
  `min_replies:10` search returned had replies, so `comments-none` was skipped.
  The connector drops a row from another conversation by `conversation_id_str`
  regardless.

- 2026-09-15T14:52+08:00 — **Closed.** The owner opened the built permalink and
  it landed on the reply. Every box is true.
