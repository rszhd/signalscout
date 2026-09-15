---
id: BUG-020
title: An Instagram comment page is recorded at five times its price
type: bug
priority: p2
created: 2026-09-15T16:15+08:00
parent: US-049
area: core
resolution:
---

## Context

**Two fields say "five credits", and the usage row multiplies them.**
`socialcrawl/instagram.ts` declares `replyPricePerUnitMicros: 5 * creditMicros`
— the whole call's price, which is what `ConnectorDescriptor` says the field
means: *what one call to `fetchReplies` costs*. Its `fetchReplies` then reports
`unitsConsumed: page.creditsUsed`, which the provider says is 5. The replies
step writes `units × pricePerUnitMicros` into `api_usage`, so one comment page
lands as 25 credits, $0.203, against the $0.0406 it cost.

Found on 2026-09-15 while building US-138, which met the same two fields on
Reddit and chose one unit per charged call.

**Three things read the inflated number.** The budget guard, which refuses a
poll past the monitor's cap — so a monitor with Instagram comments is refused
five times too early, and BUG-004's open question about the model half is
answered wrongly on this platform. The providers page's spend column. And the
figure in docs/costs.md and docs/instruments.md that says one live Instagram
poll spent $1.6317 with SocialCrawl: US-049's live run went through this
path, so that figure is a recorded number, not a measured one, and may be
about five times too high. The sentence built on it — *Instagram is the one
platform where the provider costs more than the model* — rests on it.

**The test pins the wrong value.** `instagram.test.ts` asserts
`unitsConsumed` is 5 on a captured page, which reads as the credits used and
is correct for a connector priced per credit. It is wrong beside a reply
price that is already five credits, and nothing asserts the product.

## Acceptance

- [ ] One Instagram comment page is recorded in `api_usage` at five credits,
      $0.0406, and a test asserts the recorded `estimatedCostMicros` rather
      than `unitsConsumed` alone
- [ ] A page the provider served from cache for `credits_used: 0` is recorded
      as nothing
- [ ] The rule is written once, beside `replyPricePerUnitMicros` on the
      descriptor type: a connector that declares a per-call reply price
      reports calls, and one that declares none reports its search unit. Every
      connector with `fetchReplies` is checked against it — nine now
- [ ] US-049's live figure is re-read from the run's own `api_usage` rows or
      the provider's balance, and docs/costs.md and docs/instruments.md carry
      the corrected number, or say the run must be repeated
- [ ] No test spends money

## Notes

- `packages/core/src/worker/replies.ts`, the `recordSourceUsage` call, is
  where the two numbers meet. `packages/core/src/budget/budget.ts` multiplies.
- The fix is in the connector, not the worker: the descriptor's contract is
  right and one connector broke it. Do not divide in the worker.
- US-138's `socialcrawl/reddit.ts` is the shape: `Math.ceil(creditsUsed /
  callCredits)`, so a free cached call reports zero.
- Check `live-instagram-poll.ts` while there: it prints
  `replyPricePerUnitMicros` as "a comment page", which is right, and whatever
  it summed from usage rows is what the docs quote.

## Log

- 2026-09-15T16:15+08:00 — Written. Found while building US-138 on the same
  provider with the same five-credit endpoint.
