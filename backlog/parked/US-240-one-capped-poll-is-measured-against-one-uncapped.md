---
id: US-240
title: One capped poll is measured against one uncapped
type: chore
priority: p3
created: 2026-09-20T00:56+08:00
parent: BUG-004
area: worker
resolution:
---

## Context

BUG-004 capped the model half of a poll and left one box open: what a capped
poll costs against an uncapped one, measured rather than argued. It needs a
live run, and the run that found the bug has already been paid for. Parked
until a poll is being paid for anyway.

## Acceptance

- [ ] The Log records the cost of one capped poll and one uncapped poll on the
      same monitor, from `model_calls` rows, not from an estimate.

## Notes

- `docs/instruments.md` lists the live scripts and what each spends.

## Log

- 2026-09-20T00:56+08:00 — Split out of BUG-004 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
