---
id: US-037
title: One subscription is enough
type: feature
priority: p2
created: 2026-09-06T11:48+08:00
parent:
area:
resolution:
---

## Context

**A person should not have to pay two providers to use this product.** Today
they might: Reddit replies need ScrapeCreators, X needs SocialCrawl, and a
monitor that wants both platforms wants both accounts. The owner's goal is that
either subscription covers everything the product does, and the person picks on
price and preference rather than on capability.

**This ticket is deliberately thin, and it stays thin until
[US-036](US-036-a-provider-is-rated-per-platform-from-measurements.md) closes.**
The work is "build the missing connectors", and nobody yet knows which are
missing, which are possible, or which are worth having. Scoping it now would be
guessing, and this repository has spent the month replacing guesses with
measurements. US-036 costs almost nothing and answers exactly this.

**The target is the four platforms this product already polls** — Reddit, X,
LinkedIn and YouTube. Not every platform a provider could reach: adding one of
those is PLAN.md's *Important rule*, and a separate argument.

What is already known, and one part of it is discouraging:

* SocialCrawl fetches all four today. It is already a single subscription.
* ScrapeCreators fetches one, Reddit. US-006 asked it about X and found six
  endpoints, **none of them a search** — that refusal came from the provider's
  own API, not its documentation. A provider that cannot find a stranger
  describing a problem cannot serve a platform here, however good it is at
  fetching a named account.
* So parity may be impossible in one direction. If ScrapeCreators cannot search
  X, then "either subscription is enough" cannot be true, and the honest
  outcome is to say which provider is the single one and what the other is for.
  US-036 finds out; this ticket must not assume either way.

**One thing to decide rather than inherit.** Parity does not mean every
connector does everything. ScrapeCreators reads a Reddit comment page for one
credit and SocialCrawl charges five for the same thread; making them identical
would throw away a real advantage. The goal is that a person with one
subscription can *run the product*, not that the two providers become
interchangeable.

## Acceptance

- [ ] Scoped from US-036's matrix rather than from this Context, and the
      acceptance rewritten when it is
- [ ] A person with one provider's key can create a monitor on every one of the
      four platforms this product ships, or is told plainly and early which of
      them that provider cannot serve
- [ ] Where a provider cannot do something the other can, the difference is
      declared on the connector and shown, rather than discovered by a person
      whose monitor returns nothing
- [ ] No connector is weakened to make two providers look alike. STACK.md's
      rule holds: the interface does not change to suit a provider

## Notes

- Blocked by [US-036](US-036-a-provider-is-rated-per-platform-from-measurements.md).
- `canFetchReplies` is the pattern to follow. A connector declares what it
  cannot do, the monitor form reads that declaration per platform, and a person
  ticking a box is told rather than left to find out. US-034 found that
  declaration was on the definition and not on the built connector, so whatever
  is added here is asserted against the instance a registry builds.
- Adding a connector is docs/sources.md's first list. Read it before starting.

## Log

- 2026-09-06T11:48+08:00 — Written thin, on purpose, so the goal is recorded
  where it will be found. The owner asked for it and clarified the target as the
  four platforms already integrated; the rest of the scope waits on US-036.
