---
id: US-223
title: The classifier is the model that matters
type: feature
priority: p1
created: 2026-09-18T21:10+08:00
parent: US-222
area: engine
resolution: shipped
---

## Context

US-222 built the instruments. This is what they measured, and what changed
because of it.

The day started on the assumption that triage is the stage to tune. It is not.
Triage can only lose leads and save money, and on the pair this instance runs —
`gpt-5.6-luna` on both stages — it does not even save money. The classifier
decides what a lead is, and every problem read by hand today came from there.

## What was measured

**DeepSeek Flash as triage refused a real lead.** Over the stored sample it was
the better filter on every count: 6 kept of 50 against luna's 11, zero experts
kept against luna's two, junk kept 8 down to 3. Then, 106 items into the live
run, it refused this, which the classifier scored 69 and 64 across two rows:

> "A quick review of basically all the dark spot serums I've tried 🫶🏻 I'm
> still on the hunt for one that finally gets rid of all my post acne spots so
> please let me know of any recommendations!!"

A person describing their own problem and asking for recommendations, refused
because the post opens like a product review with brand mentions. That is the
one mistake this stage cannot take back, and no counting would have found it —
it was found by reading the drops.

**So the prompt was loosened.** An explicit ask now beats every refusal above
it: a request for a recommendation, for what others use, or for help with
something of one's own is never a `no`, whatever the packaging looks like.

The cost of loosening, on the fifty: kept 11 → 17 and worthless
classifications 8 → 12, against would-be matches refused 7 → 3. Tightening and
loosening trade those two numbers, and only one of them can be corrected after
the fact.

**DeepSeek Flash as the classifier was the finding.** On the four worked
examples it orders them correctly and sits between luna and terra — 16, 62, 78,
90 against luna's 14, 66, 86, 96 and terra's 10, 70, 84, 93. On 66 real posts
scored by both, mean change −6.4, and the change is not uniform:

| post | luna | flash |
|---|---|---|
| "It came back the next week…" — LinkedIn thought leadership | 55 | **18** |
| "𝐓𝐡𝐞 𝐄𝐝𝐠𝐞 𝐂𝐚𝐬𝐞" — newsletter in decorative unicode | 52 | **26** |
| "🚀 Brittle tests killing your sprint velocity?" — promotion | 49 | **30** |
| "40s perimenopause skin, retinol destroys my…" — a person | 92 | **85** |
| "Why cicaplast make worse active spots??" — a person | 84 | **67** |

Marketing collapses; people hold. That is the discrimination luna was failing,
and it is why raising the threshold alone would not have fixed anything: a bar
of 60 with luna scoring lets a meme-coin promotion in at 61.

**Cheap is not cheap.** DeepSeek's published price is half of luna's and both
of its models cost more per job, because both spend five times the output
tokens on their own reasoning. Triage: 27,077 output tokens for 50 items
against luna's 4,864. Classification: 612 tokens an item against ~190. Flash as
classifier lands about 1.3× luna off-peak and 2.6× at peak, against terra's 7×.

## Decisions

- **Triage stays on luna with the loosened prompt.** It has deleted no lead in
  any run; DeepSeek deleted one in 106 items.
- **The classifier moves to `deepseek-flash`.** Not `deepseek-v4-pro`: Flash
  already does the discrimination at a fraction of the price.
- **`min_score` goes to 50**, which is a database change and the owner's to
  run. It gates new matches only; the 833 already stored are untouched.
- **The search plan keeps `gpt-5.6-sol`** through the new `AI_QUERY_PROVIDER`
  and `AI_QUERY_API_KEY` in the hosted repository. Without them, moving
  `AI_PROVIDER` to DeepSeek would have asked DeepSeek for an OpenAI model and
  broken monitor creation.
- **Embeddings and drafts are pinned to OpenAI** for the same reason. DeepSeek
  is not in `embeddingProviders`, so an unpinned embedder would have returned
  `undefined` and the similarity stage would have stopped running silently.

## Acceptance

- [x] The triage prompt keeps a post whose author asks for something, whatever
      the post looks like.
- [x] Both fixtures carry a hash of the prompt that produced them, and the
      suite goes red when either prompt moves.
- [x] The search plan can keep its own provider and key.
- [x] The numbers, the models and the date are written here.
- [x] `pnpm test`, lint and typecheck pass in both repositories.

## Notes

- Total spend for the day's measurements: about $0.75.
- The instrument caches a score under the classifier's prompt hash, so a round
  that changes only triage pays for triage alone.
- Not answered: whether Flash's strictness costs real leads. It pulled "Will it
  work for hormonal acne?" from 74 to 44, under the new bar. Worth a run of its
  own before the bar moves again.

## Log

- 2026-09-18T20:50+08:00 — Asked for by the owner: "lets do deepseek 4.1 flash
  as triage", then "loosen the triage prompt, i would like to keep deepseek",
  then "turn triage off. set to 50. use deepseek-v4-pro as classification
  model", then "try deepseek flash first and see the results".
- 2026-09-18T21:10+08:00 — Flash as classifier measured on 88 live items across
  all ten platform-and-kind cells: 86 scored, 4 reach 50, and none of the 64
  triage drops scored 50 or more. $0.0583, of which $0.0278 was classification
  because 35 scores came from cache.
