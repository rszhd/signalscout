---
id: US-377
title: The score breakdown's bars are ink, not the accent
type: chore
priority: p2
created: 2026-09-23T16:54+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-352 moved the match's score breakdown into the package and took the
hosted colour for its bars, the accent blue. Before that, this application
drew them in ink. The owner prefers ink and said so on 2026-09-23. The
products share one look, so the package changes and the hosted application
follows with US-271.

## Acceptance

- [x] `.score-bar i` is `var(--ink)`; the track stays `var(--line)`.
- [x] The package's tests and `pnpm lint:css` pass.
- [x] US-271 in the hosted repository says the bars change.

## Notes

- `packages/ui/src/styles/match.css`.

## Log

- 2026-09-23T16:54+08:00 — Done. Checked in the MatchDetail story. The old track was a raw
  #e5e2dc; `--line` is #e3e3e3, so the track keeps the token.
