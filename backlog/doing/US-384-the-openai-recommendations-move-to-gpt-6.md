---
id: US-384
title: The OpenAI recommendations move to GPT-6
type: chore
priority: p2
created: 2026-09-23T23:03+08:00
parent:
area: engine
resolution:
---

## Context

OpenAI released `gpt-6-sol` and `gpt-6-luna`. Each costs half of the model
it would replace in `recommended.ts`: `gpt-6-luna` against `gpt-5.6-luna` for
triage, and `gpt-6-sol` against `gpt-5.6-sol` for draft and plan. A person who
adds only an OpenAI key gets the recommendations, so the older pair costs
every such account twice what it needs to, if the new pair is as good.

A triage model is a scoring change, so the loop in `docs/instruments.md`
runs before the recommendation moves.

## Acceptance

- [x] `modelPrices` holds `gpt-6-sol` and `gpt-6-luna` at the standard price
      below 200k input tokens, read off OpenAI's page.
- [x] `capture:triage` and `capture:scores` have run on `gpt-6-luna`, and the
      Log says whether the leads survived.
- [ ] `live:triage-score` has run on `gpt-6-luna` over the stored posts.
- [ ] `recommended.ts` names `gpt-6-luna` for triage and `gpt-6-sol` for draft
      and plan, and `recommended.test.ts` agrees.
- [ ] The site's configuration page names the new pair where it names a
      working pair.

## Notes

- Classify stays on `gpt-5.6-terra`. `gpt-6-sol` has the same input price
  and a lower output price, but nothing has measured it as a classifier.
- `pinned.ts` does not change: it names the pair the hosted product sends,
  not the recommendation.

## Log

- 2026-09-23T23:03+08:00 — Prices read off
  developers.openai.com/api/docs/pricing and checked against the raw page:
  `gpt-6-sol` $2.00 in and $10.00 out per million tokens, `gpt-6-luna` $0.10
  and $0.50. The four OpenAI rows already in the table had not moved.
- 2026-09-23T23:03+08:00 — `capture:triage` on `gpt-6-luna`: 60,195 input
  and 7,833 output tokens, about $0.0099 at the new price. It kept 1 of 4
  askers, 4 of 26 answerers, 4 of 16 others, and all three worked-example
  leads. `capture:scores` with `gpt-5.6-luna` scoring reused all 50 cached
  scores and bought none. Against the pinned `gpt-5.6-luna` triage, on the
  same classifier: 12 of 50 kept against 17, leads 3 of 3 on both, the
  highest score dropped 46 on both, and 8 low-score items kept against 12.
  It refused four items that would have matched at 30, scored 46, 40, 39
  and 34.
- 2026-09-23T23:03+08:00 — The owner asked how it compares with
  `jev-latest`. Rescored `jev-latest`'s verdicts with `gpt-5.6-luna`, all
  from the cache: 15 of 50 kept, leads 3 of 3, highest drop 46, 10
  low-score items kept, three items refused that would have matched at 30
  (46, 39 and 34). Its triage cost $0.0021 for the fifty, against about
  $0.0099. `live:triage-score` was estimated at $0.065 and stopped by the
  owner before it ran.
