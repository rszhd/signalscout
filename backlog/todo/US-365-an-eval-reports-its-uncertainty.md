---
id: US-365
issue: 108
title: An eval reports its uncertainty
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: evals
resolution:
---

## Context

With 25 keeps in the triage set, one item moves recall by four points over
all, and by 17 to 25 points on one platform. A difference that size between
two prompts can be noise, and the table does not say so.

A model's answer to one item can change between runs. US-232 found this by
repeating runs by hand.

## Acceptance

- [ ] `summarise.mjs` prints a 95% confidence interval beside each precision
      and recall
- [ ] It prints the same figures per platform, and marks a platform with fewer
      than five leads as too small to read
- [ ] The harness can run each item N times, and the table shows how many
      items changed their answer
- [ ] The `measure-scoring-change` skill says a change is accepted only when
      the difference is larger than the interval

## Notes

A Wilson interval behaves well for small counts and for rates near 0 or 1.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the evals.
