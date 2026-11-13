---
id: US-576
title: A tool for sellers does not match the buyers it finds
type: feature
priority: p1
created: 2026-11-13T15:32+08:00
parent:
area: ai
resolution:
---

## Context

A monitor for a tool that finds buyers for small sellers matched shoppers.
Two of them: a person who wants a custom cross stitch pattern of a house as
a gift, and a person who wants a home IPL hair removal machine. Both asked
for a recommendation. The product line says the tool shows "posts where
people are asking for a product like yours", and the ideal customer says
"people selling a product". The classifier matched the kind of post the
product finds, not the person who would pay for it.

A floor on icpFit was considered first and dropped. The two matches had
icpFit 35 and 40, relevance 80 and 85. A floor high enough to stop them
would hide about 200 of 1,483 shown matches on the hosted product, and a
problemFit floor tried on 2026-11-05 showed that such a cut hides real
leads.

The prompt now says, in icpFit and in productFit, to judge the author: would
this person buy or use the product themselves. The productFit example is a
shopper asking where to buy a gift, a lead for a shop and not for a tool
that finds shoppers for shops. A shop's own leads are shoppers, so the rule
must leave them alone; the Log measures both sides.

## Acceptance

- [x] The classifier prompt tells the model to judge whether the author would buy or use the product, in icpFit and in productFit.
- [x] A shopper's post is not a match for a tool that finds buyers for sellers (Log, claude-sonnet-5-5).
- [x] Shops keep their shopper leads (Log, 120 stored matches from 25 monitors).
- [x] The 50 labelled items are re-captured on the pinned model, with the numbers in the Log.
- [ ] Released in a version, and the hosted product takes it.

## Notes

- Prompt: `packages/engine/src/ai/prompt.ts` (`buildSystemPrompt`, the icpFit line and the productFit section).
- `live:triage-score` was not run. Its stored sample belongs to this instance's own monitors, none of which sells to sellers, so the rule cannot act there. The hosted product's stored matches, on its own model, were used instead.
- claude-sonnet-5-5 does not always repeat the hosted product's mistake. Production matched all four shoppers below once each; locally the old prompt matched one of them every time and three of them never. Read the one it repeats as the evidence.

## Log

2026-11-13T15:32+08:00 — Hosted product's stored matches, old prompt against new, claude-sonnet-5-5 through the Claude bridge (the hosted product's classifier; second model off), match = productFit yes and score at least 40.

| Set | Old | New |
|---|---|---|
| Home IPL machine, shopper, 5 runs | 5 of 5 | 0 of 5 |
| Cross stitch house pattern, custom wooden lamp, custom controller buttons, shoppers, 5 runs each | 0 of 15 | 0 of 15 |
| 8 people selling personal items, 3 runs each | 0 of 24 | 0 of 24 |
| 120 matches of the sellers' tool, one run | 50 | 62 (47 both, 3 old only, 15 new only) |
| 120 matches from 25 other monitors, mostly shops, one run | 98 | 102 (94 both, 4 old only, 8 new only) |

The 15 new matches for the sellers' tool are sellers asking how to find buyers: realtors, an insurance agent, book authors, small service businesses. The 3 it lost are sellers too (an SEO agency, a detailing business, a lawn care business): the new prompt answered productFit no, with icpFit 15 to 25. The same kinds of business were gained in the same run (home care, cleaning, a home bakery, a pressure washing business kept), so the loss shows no pattern against service businesses, but it is a loss. Among other monitors, two shops gained shopper gift requests (photo lockets, leather goods) and the four lost were borderline: a lighting post that gives advice, a sticker purchase for a design tool, a question about another company's integration, a replacement light question.

2026-11-13T15:28+08:00 — `capture:scores --model=gpt-5.6-luna --triage-model=gpt-5.6-luna`, $0.033. Mean score 19.8 to 19.8, icpFit 14.6 to 16.6, mean change per item 3.5. The labelled leads keep their band: 68 to 75, 88 to 89, 95 to 96; low-intent 8 to 16. olbbikf 54 to 35, an item that moved 32 to 54 in the last capture. Triage drops at or above 30: 3, highest 40.
