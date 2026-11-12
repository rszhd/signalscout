---
id: US-570
title: A service delivered in person matches only posts from its place
type: feature
priority: p1
created: 2026-11-12T14:35+08:00
parent:
area: ai
resolution:
---

## Context

A cleaning service that names one region of Malaysia as the only place it
works got three matches from worldwide host groups. None of the three posts
said where its author lives. The description the monitor holds names the
region correctly, in the product and in the ideal customer.

Two parts of the classifier prompt let those posts through:

- The icpFit rule said: "When the post does not say where the author is,
  judge on the rest." For software sold in one country this is right, since
  many real buyers never say where they live. For a cleaner, a plumber or a
  clinic it is wrong: a post with no place is almost always from somewhere
  the seller cannot reach.
- icpFit weighs 0.1 of the score, and productFit, the yes or no that decides
  a match (US-523), said nothing about the place. A strong request from the
  wrong country still passed.

The rule now splits by how the product reaches the customer. Delivered in
person: productFit is no unless the post shows the place, and icpFit is 10
or less when the post says nothing about it. Used online or sent by post:
unchanged, an author shown to be elsewhere is a no and a post with no place
is judged on the rest. The owner chose to keep the second rule (2026-11-12).

Showing the model a Facebook group's name was considered and left out. The
name is read only for a post that has already matched, so the model never
has it when it scores.

## Acceptance

- [x] The classifier prompt answers productFit no for an in-person service when the post shows no sign of the service's place.
- [x] A product used online keeps its rule: a post with no place can still be a yes, an author shown elsewhere is a no.
- [x] The place test (Log) passes on claude-sonnet-5-5, the model the hosted product scores with.
- [x] The measurement loop in `docs/instruments.md` has run, with its numbers in the Log.
- [ ] Released in a version, and the hosted product takes it.

## Notes

- Prompt: `packages/engine/src/ai/prompt.ts` (`buildSystemPrompt`, icpFit and the productFit section).
- The first wording ended the in-person paragraph with "for it, where the author is counts only in icpFit". gpt-6.1-sol then answered yes to a UAE post and a US post for the Malaysian accounting product, which the old prompt answered no. Do not reintroduce that sentence.
- The second wording said a post with no place "can still be a yes" for an online product. claude-sonnet-5-5 then doubted such a post and matched it 2 of 4 times, against 4 of 4 before. "Gets no doubt for that; judge it on its problem alone" brought it back to 3 of 3.

## Log

2026-11-12T15:20+08:00 — The hosted product classifies with claude-sonnet-5-5, second model off; the runs below at 14:20 used other models. Place test on claude-sonnet-5-5, final wording, old prompt against new, threshold 40:

| Case | Old | New |
|---|---|---|
| 3 worldwide Facebook host posts, no place | 3 of 3 | 0 of 3 |
| 3 worldwide r/airbnb_hosts posts, no place | 2 of 3 | 0 of 3 |
| Dubai, Philippines, Seremban | 0 of 3 | 0 of 3 |
| "Cleaning services in KL, Bukit Jalil" | 0 of 1 | 1 of 1 |
| Other requests in the region (home, post-renovation, deep clean) | 0 of 3 | 0 of 3 |
| Accounting product, "15-person org", no place | 4 of 4 | 3 of 3, one call failed |
| Accounting product, Malaysian request | 1 of 1 | 1 of 1 |
| Accounting product, UAE and US requests | 0 of 2 | 0 of 2 |

Fixture re-captured for the final wording on gpt-5.6-luna, $0.031: 3 triage drops at or above 30, highest 41.

2026-11-12T14:20+08:00 — Place test, 18 real posts (Reddit search plus the three Facebook matches), old prompt against new, deepseek-flash and gpt-6.1-sol, threshold 40, about $0.18 a run. Counts are matches over model answers, from the runs with the final wording.

| Case | Old | New |
|---|---|---|
| 3 worldwide Facebook host posts, no place | 12 of 12 | 0 of 12 |
| 3 worldwide r/airbnb_hosts posts, no place | 3 of 6 | 0 of 6 |
| Dubai and Philippines requests | 0 of 4 | 0 of 4 |
| House in Seremban (outside the region) | 0 of 2 | 0 of 2 |
| "Cleaning services in KL, Bukit Jalil" | 2 of 4 | 4 of 4 |
| "Home cleaning, KL studio" | 4 of 6 | 3 of 6 (deepseek-flash says the post asks for home cleaning, not homestay cleaning; it names the place correctly in both answers) |
| Post-renovation and deep-clean requests in the region | 0 of 8 | 0 of 8 (a different service) |
| Accounting product, no place, two posts | 6 of 8 | 5 of 8 |
| Accounting product, Malaysian request | 4 of 4 | 4 of 4 |
| Accounting product, UAE and US requests | 0 of 4 | 0 of 4 |

2026-11-12T14:21+08:00 — `capture:scores --model=gpt-5.6-luna --triage-model=gpt-5.6-luna`, $0.031. The monitor sells worldwide, so the rule should not act. Means over the 50 items: score 19.3 to 19.7, icpFit 15.2 to 14.8. Mean change per item 5.0 points against the last capture of 2026-11-05. No productFit answer flipped. The labelled leads keep their band: 88 to 87, 97 to 96, 70 to 73; p7t2vgu 35 to 24 and olbbikf 32 to 53 move in opposite directions. Triage drops at or above 30: 2 before, 4 now, highest 41.

2026-11-12T14:29+08:00 — `live:triage-score`, 117 stored items against 8 monitors, all worldwide products, gpt-5.6-terra by jev-latest, $0.64. Against the run of 2026-10-02: mean score 16.2 to 17.9, mean change per item 5.4, matches at or above each monitor's minimum 28 to 27.
