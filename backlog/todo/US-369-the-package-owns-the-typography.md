---
id: US-369
title: The package owns the typography
type: chore
priority: p2
created: 2026-09-23T16:00+08:00
parent: US-270
area: web
resolution:
---

## Context

The owner saw this application's type look heavier than the hosted one's.
The CSS is not the cause: 343 selectors carry the same typography in both.
**The font files are.** Each application loads Figtree itself, in its own
`index.css`. The hosted one loads 400, 500, 600 and 700; this one, and the
component preview copied from it (US-351), load 400, 500 and 700. With
`font-synthesis: none` a browser draws a missing 600 with the next heavier
face it has, so the 37 rules that ask for 600 — page titles, the current
navigation item, pills, buttons — are drawn at 700 here. A test page showed
600 and 700 identical with this application's set, and distinct with the
hosted one's.

It happened because the one thing that decides how type looks was left in
each application while everything around it moved into the package. The fix
is to move it too:

- the package loads the font, all four weights, from `styles.css`;
  `@fontsource/figtree` becomes a peer dependency, as React is, because a
  package holds no dependencies (`ui-boundary.test.ts`) and both
  applications already install it;
- the base type rules each application copies — the body's size, line height
  and letter spacing, and `font: inherit` for controls — move into the
  package's `base.css`;
- a test fails when a rule in the package asks for a weight the package does
  not load, so the next weight is caught where it is added.

## Acceptance

- [ ] `@signalscout/ui/styles.css` loads Figtree at 400, 500, 600 and 700,
      and `@fontsource/figtree` is a peer dependency.
- [ ] The base type rules are in the package; this application's
      `index.css` and the preview's `preview.css` no longer hold them or
      import a font.
- [ ] A test fails for a `font-weight` the package's stylesheets use and do
      not load.
- [ ] A browser shows weight 600 lighter than 700 in this application; the
      Log says how it was checked.
- [ ] The tarball works outside the workspace with the font resolved:
      `pnpm release:verify:ui` passes.
- [ ] US-271 in the hosted repository says its font imports and base rules
      go with the rest.

## Notes

- `packages/ui/src/styles/styles.css`, a new `fonts.css` and `base.css`,
  `packages/ui/package.json`, `apps/web/src/index.css`,
  `packages/ui/.storybook/preview.css`, `scripts/verify-packed-ui.mjs`.
- Goes out in `ui-v0.2.0` with BUG-356 and US-351 to US-355.

## Log

- 2026-09-23T16:00+08:00 — Written after the owner asked how to standardise
  the type, mid-release. The release waits for it.
