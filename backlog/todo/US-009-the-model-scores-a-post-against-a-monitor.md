---
id: US-009
title: The model scores a post against a monitor
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
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

- [ ] A Zod schema defines the classification exactly as PLAN.md lists it
- [ ] `generateObject` produces a validated result, and an invalid result is
      rejected rather than stored
- [ ] The four examples in PLAN.md score within a stated band, asserted in a
      test with a recorded model response
- [ ] The reason field cites something specific from the post; a reason that
      only restates the scores fails review
- [ ] A model error, timeout or refusal leaves the post unclassified and
      retryable, and never writes a match
- [ ] A post that fails classification a bounded number of times is dropped
      and logged, not retried forever
- [ ] The happy path is asserted through the same entry point the worker calls,
      not only through the parts, so a programming error inside the error
      handler cannot pass as a handled model error
- [ ] The provider is chosen by configuration, and switching to Ollama needs
      no code change
- [ ] Each call records the model, token counts, latency and estimated cost
- [ ] A minimum score threshold decides what becomes a match, and it is
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
- Open question for the maintainer: whether the monitor's four answers go into
  the system prompt whole, or are summarised once at monitor creation and
  cached. Whole is simpler and more expensive. Decide during the work and
  record the reason here.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
- 2026-09-04 — Added the happy-path assertion through the worker's entry
  point, after adopting docs/testing.md. Without it the error handler is the
  only untested line in the file that matters most.
