---
id: US-364
issue: 107
title: The score is evaluated against human verdicts
type: chore
priority: p1
created: 2026-09-23T14:32+08:00
parent:
area: evals
resolution:
---

## Context

`evals/` holds a harness for triage only. The classifier's score decides what
reaches the inbox and in what order, and it has no harness. The default
threshold is 30. US-033's five verdicts put the boundary near 56.

The inbox is sorted by score, so a person reads the top first. Precision in
the top ten says more about what a person sees than precision over all.

## Acceptance

- [ ] `pnpm eval:score` runs the shipped classifier over US-363's golden set
      and compares each score with the human label
- [ ] It reports precision and recall at the monitor's threshold, and
      precision in the top ten per monitor
- [ ] It reports the threshold that the labels support, per platform
- [ ] The Log records the result for the pinned classifier, and whether
      `defaultMinimumScore` should move
- [ ] Like every instrument, `pnpm test` does not run it

## Notes

Needs US-363. Reuse the harness shape of `evals/triage/`: a provider that
imports the shipped code, and totals computed in `summarise.mjs`.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the evals.
