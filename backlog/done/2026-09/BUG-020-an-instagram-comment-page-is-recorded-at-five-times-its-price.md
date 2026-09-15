---
id: BUG-020
title: An Instagram comment page is recorded at five times its price
type: bug
priority: p2
created: 2026-09-15T16:15+08:00
parent: US-049
area: core
resolution: fixed
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

- [x] One Instagram comment page is recorded at five credits, $0.0406: the
      connector reports one unit per charged page, and the test asserts the
      product of units and reply price — what the usage row writes — rather
      than `unitsConsumed` alone
- [x] A page the provider served from cache for `credits_used: 0` is recorded
      as nothing
- [x] The rule is written once, on `replyPricePerUnitMicros` in `types.ts`:
      a connector that declares a per-call reply price reports calls, and one
      that declares none reports its search unit. All ten connectors with
      `fetchReplies` assert the product against the provider's charge for a
      captured page
- [x] US-049's live figure is re-read: $1.6317 is 201 recorded credits, which
      is eight pages at 25 plus one search credit, so the run cost 41 credits,
      about $0.33 — level with the model and under the cap. docs/costs.md,
      docs/instruments.md and docs/history.md carry the corrected reading.
      The run was repeated with the fix in and the provider's ledger agreed
      with `api_usage` to the credit
- [x] No test spends money

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

- 2026-09-15T16:45+08:00 — **Fixed.** One line in the connector, two
  assertions moved from 5 to 1 because the behaviour was meant to change, and
  a product assertion in every connector that reads replies so the rule is
  held at each caller rather than at one.

  The arithmetic on the live figure is tighter than the ticket guessed: 201
  recorded credits can only be eight pages at 25 and one search at 1, because
  a search is one or two credits and no other split reaches 201. So the run
  cost 41 credits and the "provider half is five times the model half"
  sentence in US-049 was the bug talking. The guard's refusal was real; the
  63% overshoot was not.

- 2026-09-15T17:05+08:00 — **Proven live, and closed.** `live:instagram-poll`
  ran again with the fix in. `api_usage` recorded 20 units, $0.7469; the
  provider's ledger, read through its free transactions endpoint, moved 1186
  to 1094 — 92 credits: two `/instagram/search/reels` at 1 and eighteen
  `/instagram/post/comments` at 5. The two numbers agree to the credit, where
  the same run under the bug would have recorded $3.67.

  It cost more than the first run's real $0.33 because nothing refused it
  early: 22 threads opened under a $1.00 cap, and the guard let all of them
  through. The first run's guard refused on a number five times too large.

  The model half is unmeasured. The OpenAI account behind `AI_API_KEY` had no
  credit, and all 20 posts were left unclassified. That is the account, not
  the code, and it is the one thing this repeat did not prove.
