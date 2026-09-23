---
id: US-375
title: The lead breakdown switch is the underline switch the inbox uses
type: chore
priority: p2
created: 2026-09-23T16:49+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-353 moved the lead sources tab into the package and took the hosted
switch for its breakdown: a full-width grey bar of four pill buttons. Before
that, this application used the theme's `.view-switch`, the underline tabs
the inbox also uses. The owner looked at both on 2026-09-23 and said the
earlier one looks better. The two products still share one look, so the
package changes, and the hosted application takes it with US-271.

## Acceptance

- [x] `LeadSources` renders its breakdown switch as `.view-switch`.
- [x] The package keeps no separate button rules for that switch.
- [x] The package's tests pass.
- [x] `pnpm lint:css` passes.
- [x] US-271 in the hosted repository says the switch changes.

## Notes

- `packages/ui/src/LeadSources.tsx`, `packages/ui/src/styles/monitor-parts.css`.

## Log

- 2026-09-23T16:49+08:00 — Done at the owner's request. The switch keeps only its bottom
  margin; the note above it gives the space on top. The owner asked for
  more space below it than before US-353: 20px, the note's space, not 12px.
