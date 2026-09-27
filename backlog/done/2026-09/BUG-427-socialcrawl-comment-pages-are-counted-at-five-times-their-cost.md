---
id: BUG-427
title: SocialCrawl comment pages are counted at five times their cost
type: bug
priority: p1
created: 2026-09-26T02:36+08:00
parent:
area: sources
resolution: shipped
---

## Context

**An Instagram or Reddit comment page at SocialCrawl costs 5 credits, and
the usage ledger records 25.** The client reports the response's
`credits_used` as `unitsConsumed`, so a comment page reports 5 units. The
Instagram and Reddit connectors declare `replyPricePerUnitMicros` as
`5 * creditMicros`, a price per *page*. The replies job then records
`units × replyPricePerUnitMicros` (`worker/replies.ts`): 5 × 5 credits.
TikTok, YouTube and X declare one credit per unit and are right.

The error runs in the safe direction — a monitor stops early, never late —
and it still misleads. signalscout-radar US-413 reported $0.63 for
Instagram; the provider's price list and the units reported put it at about
$0.15. SocialCrawl's own price list: `/v1/instagram/post/comments` and
`/v1/reddit/post/comments` are 5 credits each (the `socialcrawl` skill,
`references/pricing.md`).

## Acceptance

- [x] A test proves one Instagram comment page and one Reddit comment page
      are recorded at 5 credits, from a captured response's `credits_used`
- [x] The two connectors' reply price and what their client reports agree on
      one unit — a credit or a page — and a comment says which
- [x] `docs/costs.md` stops calling the Instagram comment the dearest item
      at the wrong figure, if it does
- [x] The Log says whether any stored `api_usage` rows need correcting

## Notes

- `packages/engine/src/sources/providers/socialcrawl/{instagram,reddit}.ts`,
  `client.ts` (`creditsUsed`), `packages/pipeline/src/worker/replies.ts`.
- Budget guard is correctness-critical: write the test first.

## Log

- 2026-09-26T02:59+08:00 — Fixed, without changing what the Providers screen shows. That screen
  prints `replyPricePerUnitMicros` as the price "per comment page", so the
  price stays per page and the two connectors now report comment units in
  pages: the provider's `credits_used` divided by five. A cached page is 0,
  a 15-credit deep scan counts as three, and units × price always equals
  what the provider charged. Tests read `credits_used` from the captured
  Instagram and Reddit comment pages (5 each, uncached) and assert one unit
  and 5 credits recorded. The replies and budget suites pass (58). No other
  SocialCrawl connector is affected: X, YouTube and TikTok price a reply
  unit at one credit and their comment calls cost one.

  `docs/costs.md` needs no change: its Instagram figure is per comment
  ($0.0027), which is right. Stored `api_usage` rows written before this
  record SocialCrawl Instagram and Reddit comment pages at five times their
  cost; production had no Instagram or SocialCrawl Reddit reply spend in the
  14 days to 2026-09-26 (read-only query), so nothing there needs correcting.
