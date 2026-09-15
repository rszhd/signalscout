---
id: US-144
title: Data and AI setup has a clear current state
type: feature
priority: p2
created: 2026-09-15T20:54+08:00
parent: US-143
area: web
resolution: shipped
---

## Context

**US-143 removed the plumbing and left two equal cards.** The behavior is
right, but the hierarchy is not. A managed account sees its current setup and
the advanced alternative given the same weight, so the page still reads as a
choice it must make instead of a working state it may leave alone.

The page should lead with one answer: what runs now. The alternative is a
secondary action underneath it. The managed state reassures the person that
the product is ready. The own-key state summarizes readiness, then places AI
settings and provider comparison beside the provider accounts they support.

The confirmation is the moment consequences matter. It should name what will
change, keep Cancel beside the action and avoid making the destructive-looking
choice feel like the default.

The provider comparison has the same navigation problem in miniature. Its
header says “Manage connections,” which sounds like another provider task.
It should return to Data & AI setup in the words the navigation now uses.

## Acceptance

- [x] Data & AI setup gives the current mode one dominant summary and presents
      the other mode as a quieter secondary action
- [x] The Active badge stays aligned with the current-state label at desktop
      and phone widths
- [x] Managed mode says it is ready without naming provider or model plumbing
- [x] Own-key mode summarizes how many provider accounts are connected
- [x] AI models and Compare providers are distinct supporting cards with a
      sentence explaining when each is useful
- [x] The mode confirmation has Cancel beside its explicit switch action
- [x] Compare providers links back with “Back to Data & AI setup”
- [x] The layout has no horizontal overflow at 1440, 768, 375 or 320 pixels
- [x] Managed mode, own-key mode and both confirmation directions render in a
      browser at desktop and phone widths
- [x] Existing screen behavior tests pass; presentation-only CSS is not tested
- [x] Lint, typecheck and production build pass

## Notes

- This is hierarchy and copy. It does not change a route, API contract or
  credential rule.
- Use the shared buttons, dialog and design tokens. Do not add another control
  component for one page.

## Log

- 2026-09-15T20:54+08:00 — Written after the first US-143 browser render. The
  owner asked for a polish pass because the behavior was clearer than the
  presentation.
- 2026-09-15T21:07+08:00 — Shipped the current-state card, quieter alternate
  action, own-key readiness summary, explanatory destination cards and Cancel
  action. Rendered both modes and both confirmation directions at desktop and
  phone widths. Measured no horizontal overflow at 1440, 768, 375 and 320
  pixels. The full suite passed 2,254 tests. Lint, typecheck and both production
  builds passed.
- 2026-09-15T21:11+08:00 — Kept the Active badge in the current-state heading
  row after the owner found that its separate phone grid row was misaligned.
  Rendered the correction at 320 and 1440 pixels. The 22 connection screen
  tests, lint and typecheck passed.
