---
id: US-136
title: SocialData reads the replies under a tweet
type: feature
priority: p1
created: 2026-09-15T13:59+08:00
parent: US-020
area:
resolution:
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

- [ ] The catalogue price of the reply endpoint is read and recorded in
      docs/costs.md, and `replyPricePerUnitMicros` carries it if it differs
      from a search
- [ ] `fetchReplies` reads one page of replies by tweet id, and pages on the
      provider's cursor
- [ ] A reply's id is the tweet id, its parent post is the tweet the caller
      asked about, and `in_reply_to` — or whatever the payload calls it — is
      stored as the parent reply when it names one
- [ ] A permalink is built from the payload's handle and id, and one was
      opened in a browser and reached the reply
- [ ] A 402 mid-thread ends the walk with `partial: true` and a reason a
      person can act on, and is never retried
- [ ] The parser replays a captured fixture: one busy thread, two pages, with
      every handle scrubbed the way `x-fixtures/capture.mjs` already scrubs
      them. US-020 found real handles committed in X fixtures once
- [ ] The monitor form's per-platform reply note reads the new declaration
- [ ] No test spends money

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
