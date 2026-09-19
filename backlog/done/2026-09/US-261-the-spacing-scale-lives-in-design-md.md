---
id: US-261
title: The spacing scale lives in design.md
type: chore
priority: p3
created: 2026-09-20T02:45+08:00
parent:
area: docs
resolution: shipped
---

## Context

`docs/spacing.md` was 458 words and `docs/design.md` already had a
*Spacing* section whose whole content was a link to it and a sentence saying
the rule was not repeated here. Two files, one subject, and a reader of
either had to open the other. The owner asked for one.

## Acceptance

- [x] `docs/design.md` holds the scale, the rule, how to snap a value, what
      is exempt and what enforces it.
- [x] `docs/spacing.md` is deleted, in both repositories.
- [x] Nothing outside `backlog/done` still links to it: README's table row
      and US-099's two references name `docs/design.md`, *Spacing*.
- [x] `pnpm lint` and `pnpm lint:css` pass.

## Notes

- The same change landed in the hosted repository under this id, the way a
  shared id works across the two series.

## Log

- 2026-09-20T02:45+08:00 — Merged. 458 words became about 300 inside the section that already
  pointed at them.
