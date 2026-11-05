---
id: US-523
title: A match is a post the product can help
type: bug
priority: p1
created: 2026-11-05T14:58+08:00
parent:
area: ai
resolution:
---

## Context

The lead score adds five answers, and none of them asks whether the product
can help this author. A post that asks for any tool earns high intent, and the
sum lets it through even when the classifier's own reasons say the product does
something else. A monitor for a design tool matched a request for a social media
scheduler at 47, with the reason "management features, not design".

Thresholds on the existing parts do not separate these posts. A floor on
`problemFit` hid real leads, because a short request names no problem. A floor
on `relevance` kept posts that only share an area with a wide product.

The owner's rule: a post is a match when the seller can write a helpful reply
where this product is the natural next step. That is a person asking for this
kind of product, or a person with a problem where useful advice leads to the
product. Advice that leads to no sale is not a match. A job ad is not a match
unless the product is a hiring product.

So the model answers that question directly, and the answer decides. The score
only sorts what passes. An application that wants this exactly sets
`min_score` to 0, so a yes on a low score is not lost. A post answered no
writes no match and keeps a `filter_drops` row with what the author asked, so
a rule that proves too strict can be read and reversed.

## Acceptance

- [x] The classifier returns `asks`, `nextStep` and `productFit`.
- [x] A post answered no writes no match, whatever its score.
- [x] A post answered no leaves a `filter_drops` row at stage `no_fit` with `asks` as its reason.
- [x] A post answered no does not pay for the second model.
- [x] A post answered yes below `min_score` still writes no match.
- [ ] The measurement loop in `docs/instruments.md` has run, with its numbers in the Log.

## Log

- 2026-11-05: Measured by hand before this ticket, on stored matches of a
  hosted application, all reads by the owner's subscription. Sonnet 5.5 and
  Opus 5.5 on 30 new posts, labelled before the results were read: Opus kept
  18 of 20 real leads, Sonnet 19 of 20, and each removed 4 of 5 non-leads. They
  agreed on 27 of 30. One reader, and every post had already passed the old
  score, so this says nothing about posts the old score dropped.
- 2026-11-05: `capture:classifier` on gpt-5.6-terra, four PLAN.md examples,
  $0.017: strong and very strong intent still score 89 and 94. `capture:scores`
  on gpt-5.6-luna for both halves, 50 items: 8 of the 17 triage kept scored 30
  or more. The fixtures are rewritten under the new prompt hash.
- 2026-11-05: The owner rules that a job ad is not a match for a freelancer or
  an agency, so the prompt says so.
- 2026-11-05: The same release teaches the describe call to say when a page
  refused the reader (`page: "refusal"`). A hosted application read
  canva.com's "update your browser" page, 342 characters, and searched for
  people with old browsers. On gpt-6.1-sol the refusal page answered
  `refusal` and three real homepages answered `site`, for $0.03.

