---
id: US-230
title: Triage can run on an evaluation model
type: feature
priority: p2
created: 2026-09-19T10:30+08:00
parent: US-229
area: ai
resolution: shipped
---

## Context

**US-229 measured Jev outside the engine and could not do anything else.**
`createTriager` builds a `LanguageModel` through `createModel` and calls
`generateStructured`. Jev is an evaluation model: it answers typed Choice,
Score and Boolean questions against one shared state through
`experimental_evaluate`, and there is no path from one to the other. Every
number in US-229 came from a script that read a run record and called Jev
itself.

**This ticket adds the option so the owner can run it on a live monitor.** It
does not promote it. `pinned.ts` stays on `gpt-5.6-luna`, the recommendation
table is untouched, and nothing changes for a deployment that does not ask for
it.

**The rule this ships is not the rule US-221 wrote, and that is deliberate.**
An evaluation model takes no system prompt, so the question is put as
structured `state` — the monitor and the item as JSON — with the decision rule
as short `instructions` and the three verdicts as Choice criteria. US-229
measured four translations over 227 items. The product's own question, which
asks whether anything says the author wants an answer, keeps 1 item in 227 when
applied to posts. The rule that works asks US-221's older question — could this
author be a person the product should reach — and keeps the clause that an
explicit ask beats every refusal. On 227 items it caught all six leads scoring
60 or more, the same six `gpt-5.6-luna` caught.

**A low-confidence refusal is not a refusal.** Jev returns a confidence
statistic that a language model cannot give. Under the shipped rule the six
real leads answered between 0.64 and 0.86, and the two leads a rule without the
ask clause lost were refused at 0.13 and 0.25. So a `no` below a floor is
treated as a keep, and the floor defaults to 0.6. That is the same rule
`triage.ts` already lives by, one step further: only an explicit `no` drops,
and a `no` the model is unsure of is not explicit.

Measured over 227 items with the floor at 0.6: 12 items sent to the classifier
against `gpt-5.6-luna`'s 17, 3 wasted calls against 7, all six real leads kept
by both, $0.119 against $0.234.

**No migration.** `ai_keys.provider` and `ai_settings.provider` are plain
`text` columns with no check constraint, and `aiTasks` does not change. The
`providers` check constraints in `schema.ts` are for source providers, which is
a different list.

## Acceptance

- [x] `AI_TRIAGE_PROVIDER=typesafe` with `AI_TRIAGE_MODEL=jev-latest` runs
      triage against Jev, and the classifier keeps running on its own provider
- [x] A refusal, a timeout, a rate limit, an unreachable provider and an answer
      that fails validation each keep the item, and `triage.test.ts` drives
      every one of those branches on the evaluation path
- [x] A `no` below the confidence floor keeps the item, and the floor is a
      named setting with 0.6 as its default
- [x] `createModel` refuses an evaluation provider with a sentence that says
      which setting to change, rather than failing inside the SDK
- [x] A triage call on Jev records a `model_calls` row with provider, model,
      tokens and cost, the same as any other call
- [x] The Models screen offers the provider for the triage job only, and does
      not offer it for classify, draft or embed
- [x] `pinned.ts`, `recommended.ts` and every existing fixture are unchanged
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and the engine
      boundary test still passes with the new dependency

## Notes

- `experimental_evaluate` landed in `ai@7.0.103`; both packages pin `7.0.92`
  and need the bump.
- `@ai-sdk/typesafe-ai` is an official provider published by Vercel on
  2026-09-18. `engine-boundary.test.ts` forbids database, queue, auth, payment
  and framework dependencies; an AI SDK provider is none of those.
- The key goes in `TYPESAFE_AI_API_KEY` for a direct key. The Vercel AI Gateway
  also reaches the model as `typesafe-ai/jev`, but its free tier allows roughly
  five calls before a long backoff, so it is not a route for a live poll.
- **Expect a thrown call on near-ties.** TypeSafe rounds probabilities to two
  decimals and the AI SDK checks that the chosen option holds the highest one.
  One answer came back `no` with `no` at 0.40 and `yes` at 0.41 and
  `experimental_evaluate` threw `AI_InvalidResponseDataError`. That is a failed
  call, which keeps the item, and the test suite must say so on purpose rather
  than by luck.
- Price: 42,000 micro-dollars per million input tokens, nothing for output.
  Measured at 43.7 micro-dollars an item over 227 items against
  `gpt-5.6-luna`'s 355.6.
- Jev cannot classify, draft or embed. It is a triage-only provider, which is a
  shape this codebase has not had before.

## Log

- 2026-09-19T10:30+08:00 — Written and started. The owner asked for the option
  so a live monitor can run it and the decision can be made on real polls
  rather than on a fitted sample. US-229 stays open: it is the held-out
  measurement, and a live run is not a substitute for it.

- 2026-09-19T10:45+08:00 — Built, and proved against the real provider. The
  engine now has a second path: `createEvaluationModel` beside `createModel`,
  `evaluateChoice` beside `generateStructured` with the same three outcomes,
  and a branch in `createTriager` that picks one by provider.

  **The tests were written before the branch and all seven failed first.** They
  cover the confident drop, the unsure keep, the floor's exact boundary, a
  caller-set floor, a provider that answers a question we did not ask, and the
  rounding tie that makes the SDK throw. The last one is real behaviour, not a
  hypothetical: the stub had to be corrected once because the SDK also refuses
  a partial distribution, which is a rule worth meeting here rather than
  discovering on a live poll.

  **No migration and no promotion.** `ai_keys.provider` and
  `ai_settings.provider` are plain text, `aiTasks` is unchanged, and
  `pinned.ts` and `recommended.ts` were not touched. The Models screen gains
  `providersFor`, so the provider is offered for triage and withheld from
  classify, draft and embed.

  **Verified end to end with four real calls**, through
  `triageConfigFromEnvironment` and `createTriager` rather than through a
  script beside them:

  | item | verdict | confidence | kept |
  |---|---|---|---|
  | a founder asking where to find customers | yes | 0.76 | yes |
  | an expert answering with advice | no | 0.47 | yes, the floor held it |
  | a removed comment under a live title | maybe | 0.12 | yes |
  | a removed comment with no title | no | 0.72 | no |

  The second row is the floor doing its job and costing a classification for
  it. The third says the parent post's title carries an empty comment: in
  production every comment gets one, so a removed comment under a good title
  reaches the classifier. That is a wasted call and not a lost lead, which is
  the direction this stage is built to fail in.

  Cost was 40 to 41 micro-dollars a call at about 960 input tokens, which
  matches US-229's 43.7 over 227 items.

  `pnpm lint`, `pnpm typecheck` and `pnpm test` pass: 2,119 tests across 117
  files, including the engine boundary test with the new dependency.

  **Not done, and the ticket stays here for it:** nothing has run on a live
  monitor. Every number above is one call or one suite, not a poll.

- 2026-09-19T14:40+08:00 — The ledger box is verified on live traffic, not on a
  test. The cloud instance has run 545 triage calls on `typesafe/jev-latest`,
  every one `scored`, every one carrying a monitor and an account, 27,913
  micro-dollars in total — about 51 an item, against `gpt-5.6-luna`'s 356.
  Nothing failed and nothing was rejected, so the rounding tie the suite covers
  has not been seen outside it yet.

  Two things the trial has shown that the fixtures could not. The stage drops
  about 55% of what reaches it, which is a far higher rate than the 227-post
  sample suggested, and the owner has read the matches it produced on one
  monitor and called all eight potential leads. That is the first human
  judgement anywhere in this work, and it is not yet recorded: `feedback` is
  still empty, so the verdicts exist only in a conversation.

  Still not done: the drops. A `live:triage-score` run over the cloud data is
  what says whether any of them was worth keeping.

- 2026-09-19T15:05+08:00 — The drops were measured, on the instance's own data,
  and they are clean. `live:triage-score --per-cell=60` over 183 stored posts,
  triage on `typesafe/jev-latest` and the classifier on `deepseek-flash`, which
  is the pair the cloud actually runs. 178 scored.

  | | items |
  |---|---|
  | dropped by triage | 171 |
  | dropped and scoring 60 or more | **0** |
  | dropped and reaching the monitor's minimum | 7, scoring 32 to 44 |
  | kept | 7, of which 4 scored below the minimum |

  **Not one lead was deleted.** The highest-scoring drop is 44, and every one
  of the seven that would have matched is marketing or hiring: "#hiring we are
  looking for a Reddit Marketing Expert", "found my first 100 customers on
  Reddit", "ReddLeads Review". Read against those, the stage is more accurate
  than the threshold it protects: `min_score = 30` admits promotional content
  as a match, and triage refuses it.

  **The confidence floor rescued nothing.** Of the seven kept, three were an
  explicit `yes` (54, 32, 31) and four were a `no` the model was unsure of,
  held by the 0.6 floor. Those four scored 21, 17, 2 and 0. The floor cost four
  classifications and saved no lead, because no lead was near the boundary. It
  is insurance that did not pay out on one sample, which is not the same as
  insurance that is not worth carrying — but it is the first evidence either
  way and it belongs in the record.

  Cost: $0.1072, of which $0.0097 was triage. The stage is 9% of the bill and
  avoids 171 classifications at roughly 550 micro-dollars each.

  This run also settled a question the owner raised and paid nothing to answer:
  whether to lower a monitor's minimum to see the 30-39 band. On this data that
  band is entirely promotional, so the answer is no, and no poll was spent
  finding out.
- 2026-09-20T00:55+08:00 — Closed. Every box was ticked on 2026-09-19; the ticket was not moved.
