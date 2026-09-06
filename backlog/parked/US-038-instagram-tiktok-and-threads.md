---
id: US-038
title: Instagram, TikTok and Threads
type: feature
priority: p3
created: 2026-09-06T11:56+08:00
parent:
area:
resolution:
---

## Context

**Parked deliberately, by the owner, on 2026-09-06.** These are the next three
platforms after YouTube. They are not being built yet, and this file exists so
that a decision is found here rather than an oversight.

**PLAN.md's own milestones put them last, and in plain words.** The list at
*Success criteria* ends: *"8. Only then expand integrations and features."*
Milestone 1 is "get the MVP working for ourselves", and that is roughly where
this product is. Two networks were added ahead of that list already — LinkedIn
in US-028 and YouTube in US-034, both crossings of PLAN.md's *Important rule*,
both recorded as decisions. A third, fourth and fifth would stop being
exceptions and start being the plan.

**The rule they are held against is unchanged**: no further network until
Reddit and X reliably produce useful matches. That condition is still unmet in
a way that is easy to state — **five verdicts exist, and forty-one matches sit
unjudged**. PLAN.md's first meaningful question is *"are people receiving
matches that they genuinely find valuable?"*, and nothing here can answer it
until somebody reads those forty-one.
[US-033](../todo/US-033-thirty-verdicts-say-whether-the-score-is-right.md) is
that work and it costs nothing.

**What is already known, so the research is not repeated.** SocialCrawl's free
catalogue, read on 2026-09-06, lists search endpoints for all three:
`instagram`, `tiktok` and `threads`, alongside a `CommentList` endpoint for
each — Instagram at 5 credits a comment page, TikTok at 1, Threads at 1. So the
provider is not the obstacle and neither is the interface: US-020 made replies
platform-neutral, and US-034 proved one parser reads every SocialCrawl comment
endpoint.

**The obstacle is that nobody knows whether these platforms hold the
conversation this product looks for.** YouTube was measured and the answer was
partial: a search returns tutorials, the lead is in the comments, and eleven
threads returned seven comments. Instagram and TikTok are further from text
than YouTube is, not closer. Threads is the nearest to X. None of that is
measured, and measuring it is cheap — the catalogue is free and one search is
one credit.

## Acceptance

Not written. This ticket is parked, and an acceptance list written now would be
a plan made before the question that decides it has been answered.

When it is unparked, it should be split: one platform per ticket, each with its
own capture, because US-028 and US-034 both found that a shared provider does
not mean a shared contract.

## Notes

- Blocked by judgement rather than by code. The gate is
  [US-033](../todo/US-033-thirty-verdicts-say-whether-the-score-is-right.md) and
  PLAN.md's milestone list.
- Threads is the strongest candidate of the three: it is text, it is
  conversational, and it is the nearest thing to X. Instagram and TikTok are
  video and image platforms where a caption is short and the comments are
  where any text lives — the YouTube shape, probably more so.
- One credit buys a search on each. A capture that answered "is there a person
  with a problem here" would cost about $0.03 per platform, which is less than
  this paragraph is worth arguing about. That is the cheap way to unpark this.
- [US-036](../todo/US-036-a-provider-is-rated-per-platform-from-measurements.md)
  covers the four platforms this product ships and deliberately not these. If
  it grows to cover them, it has stopped being about what we poll.

## Log

- 2026-09-06T11:56+08:00 — Parked at the owner's decision, in the same sentence
  they named the three platforms: finish the MVP first. Recorded rather than
  left in a conversation, because two networks have already been added ahead of
  the plan and a third would need a reason rather than a habit.
