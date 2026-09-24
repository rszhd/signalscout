---
id: US-389
title: An instance names the price it pays a provider
type: feature
priority: p1
created: 2026-09-24T11:18+08:00
parent:
area: sources
resolution:
---

## Context

**Every connector carries one price, and it is the provider's dearest.** The
rule is in `docs/costs.md`: a volume discount is not modelled, so a figure is
high, never low. That is the right default for a self-hoster who has told us
nothing. It is wrong for an instance that knows what it pays.

The hosted product buys SocialCrawl's £49 Growth pack: $0.0033 a credit
against the $0.0081 of the £15 pack every SocialCrawl connector declares. The
budget guard, `api_usage` and every spend figure count 2.4 times what was
paid, so an allowance sized in dollars fills 2.4 times too fast. On Instagram
that stops a busy account around day 23 of a month it has paid for (US-387's
margin work, 2026-09-24). HarvestAPI's larger top-ups and every other pack
have the same shape.

**What is needed is one number per provider, given by the caller**: the price
of the provider's unit as this instance buys it. A connector's declared
prices stay as they are and stay the default.

**Scaling rather than replacing.** A provider's connectors do not share one
price: SocialCrawl bills an Instagram comment page at five credits and a
search at one, and both are declared from one credit price. So the caller
names the price of the provider's own unit, and each connector's post and
reply prices move by the same ratio. A ratio keeps the five-to-one intact
without the caller knowing about it.

**The failure to guard against is a price set too low**, which lets a monitor
spend past its cap unseen. The code cannot know the right price, so it accepts
any positive one: above the declared price (the provider raised it) or below
(a larger pack). It refuses a zero, a negative or a non-number at boot, which
are the typos that would make spending invisible.

## Acceptance

- [x] `withInstancePrices` takes a price per provider id, in micro-dollars
      per provider unit, and returns definitions whose connectors report
      scaled `pricePerUnitMicros` and `replyPricePerUnitMicros`
- [x] The scaled prices reach every reader: the budget guard, `api_usage`,
      the cost test, a resumed collection and deletion verification
- [x] With no prices, every definition is returned as it was
- [x] A zero, negative or non-numeric price refuses at boot, naming the
      provider
- [x] `docs/costs.md` and `docs/sources.md` say where an instance's price
      comes from

## Notes

- The consumer is the hosted product: US-390 there.
- Open question for the owner: should a self-hoster get the same setting
  through `.env`? Not in this ticket's scope unless asked.
- The prices are applied to the definitions, not inside the registry: the
  cost test reads definitions and never the registry, so a price applied only
  in the registry would reach every reader but that one.

## Log

- 2026-09-24T11:18+08:00 — Written at the owner's request, before building.
- 2026-09-24T12:30+08:00 — Built. `withInstancePrices(definitions, prices)`
  returns copies of the named provider's definitions with both prices scaled
  by paid over list, and each copy builds a connector that reports the same
  prices; everything else on it is the original's. A provider carries its
  list unit price as `ProviderDescriptor.unitPriceMicros`, set on five of the
  six. Apify has none, because its connector turns its dollar bill into
  units at the list price, so a price given for it is refused.

  **Which readers were proven, and how.** A poll through a priced connector
  recorded 3 units at the paid price in `api_usage`, which the budget guard
  sums, and in `poll_runs` (`worker/instance-prices.test.ts`). The replies
  step, a resumed collection and deletion verification read the connector
  the registry builds, and the engine test proves that connector carries the
  paid prices. The cost test reads the definitions, which carry them too.
  Those four are proven by construction, not each by its own poll.

  Suite: 149 files, 2,475 tests pass.
