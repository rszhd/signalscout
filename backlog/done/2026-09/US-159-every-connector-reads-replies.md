---
id: US-159
title: Every offered connector reads replies
type: feature
priority: p2
created: 2026-09-17T00:40+08:00
parent: US-020
area:
resolution: shipped
---

## Context

US-020 built replies as a platform-neutral capability and left four connectors
declaring that they could not read them, each for a reason written into its
descriptor. Three of those reasons were sound and one was a measurement. The
owner asked on 2026-09-17 for all four, and the question this ticket had to
answer first was whether any of the four reasons still held.

**The trap the four gaps made.** `canFetchRepliesFor` narrows to the provider
an instance has a key for, so an instance holding the wrong key on a platform
was told "no replies" truthfully — but LinkedIn had no reply path on *any*
provider, and on Reddit, X and YouTube the cheaper or fresher provider was the
one without. A person choosing a provider on price was choosing, silently, to
lose the conversation.

**Two of the four were "a ticket, not a default", and the ticket answered
both cheaply.** SocialData's comments endpoint had never been priced: its own
balance either side of a call says a reply is 200 micro-dollars, the post
price, and its links are the same built form US-060 already opened. Apify's
comment price is in the actor's `pricingInfos`, free to read: a comment is
priced exactly like a post. Nobody had asked.

**One reason was wrong on the evidence and right on the money.** US-020 wrote
SocialCrawl Reddit down as the escape hatch at twenty-two times the price.
The capture says what the five credits buy: 34 of 34 claimed comments, five
levels deep, in one call, with `truncated: false` — the first completeness
claim this repository has measured right. On the median twelve-comment thread
the cheap connector finishes too and the dear one is waste; on a busy thread
the cheap one has been measured stopping at 43 of 95 while calling itself
done. So both are offered and the form states the price.

**One reason still holds and the connector says so in its header.**
ScrapeCreators YouTube: `order` is ignored, both values returned the same
page; no comment carries a link or a parent id; every date is arithmetic on
"4 years ago". It exists so an instance with only that key is not given
nothing, and it marks every reply approximate. It is the weakest reply answer
in the product and the header says which connector is better.

**The interface held.** Nothing in `SocialSource` changed. Two comments on it
were out of date and were corrected: Apify's actor offers a server-side
`postedLimit` window, and SocialData reads by id rather than by URL.

## Acceptance

- [x] ScrapeCreators YouTube fetches a page of comments by video URL, pages on
      `continuationToken`, marks every reply `postedAtIsApproximate`, builds
      the `&lc=` link, and never sets a parent reply. Tests replay three
      captured pages
- [x] SocialCrawl Reddit fetches the whole nested thread in one call, flattens
      it depth first, reports `itemsReturned` as the flattened count, and
      believes `truncated`. Tests replay the captured thread and prove the one
      wordless comment is dropped and its child kept
- [x] SocialData X fetches replies by post id, checks `conversation_id_str`,
      reads `full_text`, builds the post-style link, stops paging when the
      page's oldest reply is outside the window, and is not partial when it
      stops for that reason. Tests replay two captured pages and the overlap
- [x] Apify LinkedIn runs `linkedin-post-comments` by post URL, waits for the
      run with a bounded number of asks, flattens nested replies carrying the
      parent down, compares the bare activity id under `postId`'s urn, sends
      `postedLimit` from the comments actor's own list, and prices a comment
      like a post. Tests replay the captured run
- [x] Every descriptor declares `canFetchReplies: true` and a
      `replyPricePerUnitMicros`, so the monitor form and the budget guard read
      the truth without building a connector
- [x] Each of the four capture scripts has a `--only=comments` mode that
      merges into the folder's record rather than replacing it, and the
      fixtures it wrote were read before they were committed
- [x] docs/sources.md carries a table of who reads replies, at what price, in
      what order, and with what completeness claim
- [ ] A live poll with `includeReplies` on has run through each of the four —
      **not done**. Every connector here is proven against captured payloads
      only

## Notes

- Total spent on captures: about $0.008 ScrapeCreators, $0.041 SocialCrawl,
  $0.012 SocialData, $0.008 Apify.
- **Two scrubbers leaked on their first pass and both grew a rule.** The X
  capture let six handles through `user.affiliation_label.label_url` and a
  truncated `display_url`; the LinkedIn capture let a real name through the
  `PROFILE_MENTION` span of `commentary` while scrubbing the attribute beside
  it. The committed files were rewritten in place with the new rules, numbering
  on from each file's last pseudonym.
- SocialCrawl Reddit's `author.username` is filled on all 34 comments here,
  where US-020 measured it null. Author presence is per thread, not per
  platform, and the parser requires nothing it may not get.
- SocialData returned one reply on both pages. `UNIQUE (source, external_id)`
  stores it once; the connector reports and bills what it was sent.
- The Apify comments actor returned nested replies without `scrapeReplies`,
  and the run with the flag charged the same two events. One post is one
  measurement; the connector sends no flag and does not rely on the nesting
  being free.
- The Apify `fetchReplies` is the one reply call that waits inside the job.
  `replies.ts` ends its walk on any status but `ready`, so a `wait` returned
  there would lose a run already paid for. The wait is twelve asks five
  seconds apart, and running out throws naming the run.
- `Page.truncated` was added to the SocialCrawl client for the Reddit
  envelope's completeness claim. Nothing else sets it.

## Log

- 2026-09-17T00:40+08:00 — Opened, on the owner's request for all four. Read
  the four descriptors: two said "a ticket, not a default", two said "measured
  against". Found US-020 still open with a stale LinkedIn box.
- 2026-09-17T00:57+08:00 — ScrapeCreators YouTube: four credits. `order`
  ignored, dates computed, no link, no parent id, `continuationToken` pages
  cleanly. Built with every reply marked approximate and the window still
  applied — the departure from `search` that US-034's 1,915-day-old comment
  demands.
- 2026-09-17T01:04+08:00 — SocialCrawl Reddit: five credits, 34 of 34
  comments, `truncated: false` measured right. One comment has no words and is
  dropped; its child is stored naming a parent with no row, and the test says
  so rather than tidying it.
- 2026-09-17T01:10+08:00 — SocialData X: found the endpoint by asking for it,
  $0.012 across a `min_replies:20` search and two pages. Newest first on both,
  the only reply endpoint that may stop early. One reply overlapped.
- 2026-09-17T01:20+08:00 — Apify LinkedIn: read both actors' pricing and input
  schemas for free, chose `linkedin-post-comments` over the search flag, ran it
  twice on the busiest committed post for $0.008. The wait loop counts asks,
  not the clock, after the first version would have spun under a frozen test
  clock.
- 2026-09-17T01:26+08:00 — Audited the fixtures. Six X handles and one
  LinkedIn name had leaked; both scrubbers fixed and both files rewritten.
  2,055 tests pass, lint and typecheck clean. Nothing has met a live poll.
