---
id: US-032
title: The classifier reads with the careful model
type: chore
priority: p2
created: 2026-09-06T02:54+08:00
parent: US-030
area:
resolution:
---

## Context

US-030 built the triage stage and then measured it into a corner. The stage
saves nothing unless the model behind it is dearer than the model in front. On
2026-09-06 this deployment ran `gpt-5.6-luna` for both, so triage made 46
comments **48% dearer** instead of 48% cheaper.

The fix is one setting: classify with `gpt-5.6-terra` and triage with
`gpt-5.6-luna`. Terra is ten times luna on both halves, which turns the same
measurement from +48% to −48%.

**It is a ticket rather than an edit because the fixtures move.**
`ai/fixtures/*.json` were captured from luna, and AGENTS.md's rule is to re-run
a capture when its prompt, its schema or the model changes. The model is
changing. So `capture:classifier` and `capture:queries` both run again, and
`ai/examples.test.ts` replays different numbers afterwards.

**Two of those numbers are not cosmetic.** `defaultMinimumScore` was chosen
from what luna scored PLAN.md's four worked examples — 7, 64, 86 and 96 against
planned intents of 3, 50, 90 and 96. If terra scores them differently the
default threshold is a number chosen for a model nobody is running any more.
And US-027's query rule — four words on X, eight on Reddit — was proven against
luna's output; a different model may not obey a limit the same way.

**Nothing here is a code change.** The price table already carries all three
models, the config already reads `AI_TRIAGE_MODEL` apart from `AI_MODEL`, and
the worker already warns when the two match. This ticket changes the setting,
re-runs the instruments, and writes down what moved.

## Acceptance

- [x] `AI_MODEL` is `gpt-5.6-terra` and `AI_TRIAGE_MODEL` is `gpt-5.6-luna`, in
      `.env.example` as the documented pair and in the local `.env`
- [x] `capture:classifier` has run against terra and its fixtures are committed
- [x] `capture:queries` has run against terra and its plan is committed
- [x] `ai/examples.test.ts` passes, and the Log says which scores moved and by
      how much
- [x] The Log says whether `defaultMinimumScore` still sits in a gap between
      the worked examples that are leads and the one that is not, and the
      number is moved or explicitly kept
- [x] Every X query in the new plan is four words or fewer and every Reddit
      query eight or fewer, or the Log says the rule was broken and what was
      done
- [x] The startup warning about matching models no longer fires, checked by
      resolving the real `.env` through the real config functions
- [x] AGENTS.md records the model in use and what the change cost

## Notes

- Depends on [US-030](US-030-a-cheap-model-decides-which-comments-the-good-model-reads.md).
- Prices, read 2026-09-06 and already in `ai/provider.ts`: luna $0.20 and $1.20
  per million tokens, terra $2.00 and $12.00.
- Cost of the two captures: five short calls on terra, well under a cent.
  Classification is 680 input and 95 output tokens, so one call is about 2,500
  micro-dollars.
- The classifier gets ten times dearer per post. That is the point — it reads
  far fewer of them — but the arithmetic on the monitor form and in
  docs/costs.md quotes model prices, so check whether any figure shown to a
  person is now wrong.
- `ai/triage-verdicts.json` was captured from luna and stays as it is. Triage
  is still luna, so that fixture is still evidence about the model that runs.
- Do not re-run `capture:embeddings`. The embedding model is named separately
  and does not change here.

## Log

- 2026-09-06T02:54+08:00 — Written. US-030 measured the cascade upside down on
  one model and the owner chose the pair. The work is the two captures and what
  they move, not the setting.

- 2026-09-06T02:57+08:00 — Done, for $0.018. `capture:classifier` cost $0.011274
  and `capture:queries` $0.006886, both against `openai/gpt-5.6-terra`.

  **The scores moved and the order held.** Terra scored PLAN.md's four worked
  examples 10, 70, 84 and 93 where luna scored 7, 64, 86 and 96, against planned
  intents of 3, 50, 90 and 96.

  | Example | Luna | Terra |
  |---|---|---|
  | Low intent | 7 | 10 |
  | Mild problem signal | 64 | 70 |
  | Strong intent | 86 | 84 |
  | Very strong intent | 96 | 93 |

  **`defaultMinimumScore` stays at 30, and the gap it sits in got wider.** The
  drop is at 10 and the first match at 70, so the gap is 60 points against
  luna's 57, and 30 sits inside it with room on both sides. The number is kept
  deliberately rather than left alone: it was chosen from luna's numbers and it
  is still right for terra's.

  Terra is also the stricter reader at the top and the more generous one at the
  bottom — it scores the two real leads a little lower and the weakest example a
  little higher — which narrows the range but not the ordering. Four examples is
  not a distribution and nothing here may be written up as one.

  **Every query in the new plan is inside its platform's limit**: 8 Reddit
  queries at most 7 words, 7 X queries at most 3, 8 LinkedIn queries at most 8.
  US-027's rule needed no defending. The plan named 8 subreddits, one of which
  is `r/cypressio` — a competitor's community, which is a new idea and worth
  someone's judgement before a monitor polls it.

  **The startup warning no longer applies.** Resolving the real `.env` through
  `aiConfigFromEnvironment` and `triageConfigFromEnvironment` gives
  `openai/gpt-5.6-terra` classifying and `openai/gpt-5.6-luna` triaging, a
  ten-to-one gap on output. That is the configuration US-030 measured at 48%
  cheaper rather than 48% dearer.

  913 tests pass, `ai/examples.test.ts` among them, with no assertion changed:
  every terra score landed inside the band luna's had.

- 2026-09-06T02:58+08:00 — One thing this ticket found and did not fix. The
  shipped default in `.env.example` is `claude-haiku-4-5`, and `provider.ts`
  carries nothing cheaper, so a deployment that keeps the default runs triage on
  the same model and pays for it. The warning fires and `.env.example` now says
  so in full, but the default itself is a product decision and belongs to
  whoever owns the shipped configuration.
