---
id: US-053
title: The interface has one component library
type: chore
priority: p2
created: 2026-09-07T01:58+08:00
parent:
area: web
resolution: shipped
---

## Context

`STACK.md` chose Tailwind and shadcn/ui, but the screens still rendered their
own buttons, inputs, textareas, selects, labels and status pills. Shared CSS
made them look related without giving them one API, so a new state or variant
had to be repeated across screens and could drift.

Shadcn/ui fits the self-hosted application because its source lives in this
repository. Its primitives can keep the existing theme and native form
semantics while giving every screen the same variants, sizing, focus treatment
and invalid state.

## Acceptance

- [x] The web app has an initialized shadcn/ui configuration and owns the
      component source it uses
- [x] Buttons, text inputs, textareas, native selects, labels and status badges
      have shared React primitives
- [x] Existing screens use those primitives for their general-purpose controls
- [x] Existing semantic tokens provide the shadcn theme roles; no second visual
      theme is introduced
- [x] Links that look like buttons stay links, and checkboxes, radio buttons,
      disclosures and specialized switch controls keep their native behavior
- [x] Web interaction tests, typecheck, production build and license check pass
- [x] The changed screens render correctly in a real browser at desktop and
      phone widths

## Notes

- Presentation does not get CSS-value assertions. The existing screen tests
  drive the migrated controls through their labels and visible button text.
- `NativeSelect` deliberately keeps the browser picker. A composed popup would
  change keyboard and form behavior without solving a product need.
- The copied component source retains shadcn/ui's MIT notice in
  `apps/web/src/components/ui/LICENSE.md`.

## Log

- 2026-09-07T01:58+08:00 — Written after implementation began at the owner's
  request. That is later than AGENTS.md requires; the sequence is recorded
  rather than hidden.
- 2026-09-07T02:03+08:00 — Chrome rendered the project list, project editor and
  monitor form at 1,440px and 375px. The phone form held its 375px viewport,
  buttons stayed 44px tall and the shared fields kept their focus treatment.
  All 135 web tests passed. Typecheck, production build and the license check
  passed. The full 1,182-test run had the documented load-sensitive
  `classify.test.ts` wait fail; its isolated 21-test run passed.
- 2026-09-07T02:10+08:00 — The owner asked for shadcn's defaults rather than a
  second component stylesheet. Removed that stylesheet and the remaining
  general control rules. The components now carry the registry's Tailwind
  classes and the site supplies only semantic theme roles. Chrome measured the
  default 36px buttons and inputs, a visible themed focus ring and no overflow
  at 375px. NativeSelect's standard hidden chevron corrected one inbox test
  that had mistaken every SVG for a chart. All 135 web tests passed again.
