---
id: US-009
title: The model scores a post against a monitor
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

This is the product. Everything else moves posts around; this decides which
ones a person should read.

PLAN.md gives the output shape — relevance, problemFit, icpFit, intent,
urgency, an intent type and a reason — and gives four worked examples with
the scores they should receive. Those examples are the first tests. A
classifier that scores "Playwright is awesome" above 10 is wrong, and that is
checkable without an opinion.

`generateObject` from the AI SDK takes a Zod schema and returns parsed,
validated JSON. That removes the whole class of bugs where a model returns
prose around its JSON, and it is why STACK.md chose the SDK over provider
SDKs.

Two things this ticket must get right beyond the prompt.

**The reason is not decoration.** PLAN.md's inbox mockup shows why a post
matched, as a list of specific claims about that post. A reason that restates
the scores is useless. The schema should force specifics.

**A model call can fail or return nonsense.** A refusal, a timeout, or a score
of 150 must not write a match. The post is marked unclassified and retried,
and a post that fails repeatedly is dropped rather than retried forever.

Provider choice belongs to the user. The same prompt must run against OpenAI,
Anthropic, Google, OpenRouter and Ollama. Local models will be worse at
structured output, so a parse failure is an expected path, not a crash.

## Acceptance

- [x] A Zod schema defines the classification exactly as PLAN.md lists it
- [x] `generateObject` produces a validated result, and an invalid result is
      rejected rather than stored
- [x] The four examples in PLAN.md score within a stated band, asserted in a
      test with a recorded model response
- [x] The reason field cites something specific from the post; a reason that
      only restates the scores fails review
- [x] A model error, timeout or refusal leaves the post unclassified and
      retryable, and never writes a match
- [x] A post that fails classification a bounded number of times is dropped
      and logged, not retried forever
- [x] The happy path is asserted through the same entry point the worker calls,
      not only through the parts, so a programming error inside the error
      handler cannot pass as a handled model error
- [x] The provider is chosen by configuration, and switching to Ollama needs
      no code change
- [x] Each call records the model, token counts, latency and estimated cost
- [x] A minimum score threshold decides what becomes a match, and it is
      settable per monitor

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-007](US-007-the-worker-runs-jobs-on-a-schedule.md).
- PLAN.md, *Intent classification*, for the examples and the intent types.
- [docs/testing.md](../../docs/testing.md), *A broad catch obliges an assertion
  on the happy path*. The failure shape to avoid: the catch swallows a
  programming error, nothing is ever scored, and an empty inbox reads as a
  quiet day rather than a broken product.
- The four examples in PLAN.md are the start of the labelled set described in
  *Testing the model*. Grow it from real matches and from US-012 feedback.
- Settled: **the monitor's four answers go into the system prompt whole.** The
  answers are four form fields a person typed, so a summary saves tens of
  tokens against a post that costs hundreds, and the system half of the prompt
  is the half a provider caches across a poll. The cost that decided it is not
  tokens: a summary is a second model output that nothing checks, so a wrong
  score would have two possible causes and no way to tell them apart.
  Revisit when a monitor holds more than a form. `ai/prompt.ts` carries this.
- The lead score the inbox sorts on is computed here, not asked of the model:
  a model that returns both the parts and the total can contradict itself, and
  nothing downstream could say which half was wrong. The weights are in
  `ai/classification.ts` and `capture.ts` prints them.
- `model_calls` is new. It records every call, not only the ones that matched,
  because a refusal is billed like an answer, US-013 needs spend it can add up,
  and the bounded retry is a count of its rows rather than state in one job.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md and STACK.md.
- 2026-09-04T22:54+08:00 — Added the happy-path assertion through the worker's entry
  point, after adopting docs/testing.md. Without it the error handler is the
  only untested line in the file that matters most.
- 2026-09-05T02:17+08:00 — Built. `ai/` holds the schema, the prompt, the provider and the
  classifier; `worker/classify.ts` is the step the scheduler already called.
  Migration 0003 adds `monitors.min_score` and the `model_calls` table.
- 2026-09-05T02:17+08:00 — The restatement guard passed on the day it was written, which
  docs/testing.md says means it is wrong or incomplete. It was: the case fed
  the same bad reason twice, so the rule against repeating a claim rejected it
  and the restatement rule was never reached. Fixed the case, then removed the
  rule and watched five assertions go red. Five other guards were broken on
  purpose the same way: the score range, the narrow catch, the per-monitor
  threshold, the already-scored skip and the attempt cap. Each was caught.
- 2026-09-05T02:17+08:00 — Ran `capture:classifier` against openai/gpt-5.6-luna. The bands
  in `ai/fixtures/examples.ts` were written before it ran, and all four fall
  inside them. Lead scores, at the weights in `ai/classification.ts`:

  | Example | PLAN.md intent | intent | lead score |
  |---|---:|---:|---:|
  | Playwright is awesome | 3 | 0 | 9 |
  | Tests break on every UI change | 50 | 25 | 62 |
  | Is there something easier? | 90 | 92 | 86 |
  | What are other small teams using? | 96 | 95 | 94 |

  This is the evidence for the default minimum score of 30: it drops the first
  and keeps the other three, and the gap between 9 and 62 is wide enough that
  the number is not balanced on one example. Left permissive on purpose — a
  silent false negative is worse than a noisy inbox.

  One near-miss worth naming: the model scores the mild signal at intent 25
  where PLAN.md says 50. It is inside the band, so nothing changed. It says
  this model reads a complaint with no question as weaker intent than PLAN.md
  does. Watch it when the labelled set grows from real feedback (US-012).

  The run also showed that no price is configured for this model, so every
  `model_calls` row from it records a null cost. That is the honest answer,
  and the capture now says "unknown" rather than summing an unknown as zero.
- 2026-09-05T02:17+08:00 — Unproven until it runs somewhere real: the failure paths. The
  happy path met a live provider in the capture, but a real rate limit, a real
  refusal and a real timeout have only been simulated.
