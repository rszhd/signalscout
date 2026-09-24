---
id: US-363
issue: 106
title: The eval set is frozen, and split into a tuning half and a held-out half
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: evals
resolution:
---

## Context

`evals/triage/dataset.json` holds 227 items. The expected answer of each is
"keep" when the classifier's score clears the monitor's threshold
(`build-dataset.mjs`, `assertionsFor`). So the eval measures agreement with
the classifier, not with a person. If the classifier is wrong, the eval
rewards the same mistake.

The same items tune a prompt and judge it, so a prompt can fit these 227
posts and not the next ones.

Only 25 items are keeps: 10 Reddit, 6 X, 5 YouTube, 4 TikTok, 0 LinkedIn.

## Acceptance

- [ ] `evals/golden/` holds items labelled by a person, from US-033's
      verdicts, with the label, the labeller and the date on each
- [ ] The set has at least 100 items and at least 30 leads, and the Log
      gives the count per platform
- [ ] 20 items are labelled a second time a week later, without the first
      label, and the Log records the agreement
- [ ] The set is split into `dev` and `holdout`, by a fixed seed, balanced
      per platform
- [ ] The `measure-scoring-change` skill tunes on `dev` and runs `holdout`
      only at promotion
- [ ] The model-labelled `dataset.json` stays, named as a comparison with the
      classifier and not as ground truth

## Notes

Needs US-033. BUG-311 blocks `pnpm verdicts` as the labelling tool.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the evals.
