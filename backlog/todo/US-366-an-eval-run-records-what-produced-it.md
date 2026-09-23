---
id: US-366
title: An eval run records what produced it
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: evals
resolution:
---

## Context

Twelve `triage-score-*.json` files sit in `packages/pipeline/`, ignored by
git. Their names give the models and the date, but not the prompt, the
dataset or the confidence floor. Two runs can be compared only when these
are the same, and today nothing says whether they are.

## Acceptance

- [ ] Each eval and capture run writes one record under `evals/runs/`, with
      the dataset hash, the prompt hash, the models, the confidence floor,
      the cost and the date
- [ ] `summarise.mjs` compares two records and refuses when the dataset hash
      differs
- [ ] No run writes its result to a package root any more

## Notes

US-335 gives the paid-run scripts one harness. That harness is the place to
write the record.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the evals.
