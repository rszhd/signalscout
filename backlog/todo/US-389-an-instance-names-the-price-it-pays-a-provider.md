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

- [ ] `createSourceRegistry` takes an optional price per provider id, in
      micro-dollars per provider unit, and each connector built from it
      reports scaled `pricePerUnitMicros` and `replyPricePerUnitMicros`
- [ ] The scaled prices reach every reader: the budget guard, `api_usage`,
      the cost test, a resumed collection and deletion verification
- [ ] A registry built without the option prices exactly as today
- [ ] A zero, negative or non-numeric price refuses at boot, naming the
      provider
- [ ] `docs/costs.md` and `docs/sources.md` say where an instance's price
      comes from

## Notes

- The consumer is the hosted product: US-390 there.
- Open question for the owner: should a self-hoster get the same setting
  through `.env`? Not in this ticket's scope unless asked.
- `SourceRegistry` is the one place every consumer builds connectors from,
  which is why the option belongs there and not on a connector.

## Log

- 2026-09-24T11:18+08:00 — Written at the owner's request, before building.
