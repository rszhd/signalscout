---
id: US-347
title: PLAN.md holds the product rules and nothing else
type: chore
priority: p2
created: 2026-09-23T12:16+08:00
parent: US-346
area: docs
resolution: shipped
---

## Context

PLAN.md was the plan the product started from, and it still reads as one.
Checked against the code on 2026-09-23, much of it had turned into history
or become wrong: the cloud section described bring-your-own-keys at $20 a
month when the cloud includes the keys and sells three plans (US-164 in the
hosted repository), the flow showed two platforms and a dashboard, monitor
creation knew nothing of projects, and the feedback loop read as if verdicts
already trained the classifier. `AGENTS.md` tells every agent to read it
before a structural proposal, so a wrong line here is a wrong line in every
proposal.

The owner asked whether the file is needed at all. It is, for less than it
holds:

- **Its worked examples are the classifier's labelled set.**
  `ai/fixtures/examples.ts`, `classification.test.ts`, the capture scripts and
  `docs/testing.md` name them as their source.
- **Code cites five of its sections by name**: *Monitor creation*, *Intent
  classification*, *Monitoring flow*, *Feedback loop*, *Important rule*, and
  the README cites the *not building* list.
- **It holds the rules that stop scope creep**: the one question, what is
  not built, the seventh-network rule, the success question.

What it no longer needs: describing the product (the README and the docs
site do), the cloud's business model and prices (the hosted repository and
the pricing page own them, and this repository charges nobody), the
positioning ideas, the pricing tiers, the architecture sketch and the UX
notes (README, STACK.md and `docs/` hold each more accurately), and the wish
list of future platforms.

## Acceptance

- [x] Every section a file names keeps its heading.
- [x] The worked examples, the example monitor, the inbox card's bullets and
      the intent-type list are unchanged, so every test that copied them
      still matches its source.
- [x] Every fact left is true of the code: six platforms, the three cheap
      stages, projects, the monitor steps, the signal labels in
      `packages/engine/src/signals.ts`.
- [x] The feedback loop says it is a goal nothing implements yet.
- [x] The cloud is one paragraph with no price, no plan and no key policy
      beyond "included".
- [x] The word count before and after is in the Log.

## Notes

The hosted repository's own AGENTS.md says it is built on the packages and
charges; nothing here needs to repeat that.

## Log

- 2026-09-23T12:16+08:00 — Written after checking PLAN.md against the code on
  the owner's question.
- 2026-09-23T12:19+08:00 — 2,312 words to 1,431. Kept, unchanged: the example monitor, the
  four worked examples, the classification fields, the intent types, and the
  inbox card's bullets, which the tests copied. Corrected: the flow (six
  platforms, three cheap stages, five outputs, no dashboard), monitor creation
  (the project holds the answers; the monitor adds signals, sources, plan,
  schedule and budget; the labels are `signals.ts`'s), the feedback loop
  (a goal nothing implements), and the milestones (the cloud launched on
  2026-09-10). Cut: the BYOK example, the per-platform signal lists, the
  architecture sketch, the future-integration wish list, the pricing tiers,
  the positioning ideas and the thesis, each held more accurately elsewhere.
  The cloud is one paragraph: separate, includes usage, charges, and its
  prices live there.
