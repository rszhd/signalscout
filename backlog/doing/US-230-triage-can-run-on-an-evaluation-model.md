---
id: US-230
title: Triage can run on an evaluation model
type: feature
priority: p2
created: 2026-09-19T10:30+08:00
parent: US-229
area: ai
resolution:
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
- [ ] A triage call on Jev records a `model_calls` row with provider, model,
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
