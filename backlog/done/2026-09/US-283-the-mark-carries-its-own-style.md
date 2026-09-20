---
id: US-283
title: The mark carries its own style
type: chore
priority: p3
created: 2026-09-20T19:25+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

`BrandLogo` lives in `@signalscout/ui` since US-272, but its style does not.
Each application keeps a `.brand-logo` rule in its own `index.css`, and each
onboarding page keeps a second rule to make it 40 pixels. The open app's copy
of the first rule still had `border-radius: var(--radius-sm)` from the old
square radar logo. The canonical mark is nine dots on a transparent ground,
and four of the dots touch the corners of the drawing, so an 8-pixel clip on
a 32-pixel image cut a flat edge into the blue dot. The owner saw the sidebar
logo look wrong and asked that the mark be one reusable component: it renders
itself, and no application restyles it.

## Acceptance

- [x] `theme.css` in the package owns the `.brand-logo` rule; no page
      stylesheet in the open app names `.brand-logo`.
- [x] The rule sets no clip, no radius and no fixed size: the size comes from
      the component's `size` prop, and the onboarding page asks for 40.
- [x] A test in the package renders the mark at the default and at a given
      size, and a test reads the rule and fails if a radius or a size returns.
- [x] `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`, `pnpm release:verify:ui`
      and the web and package tests pass.

## Notes

- `packages/ui/src/BrandLogo.tsx`, `packages/ui/src/styles/theme.css`.
- `apps/web/src/index.css`, `styles/onboarding.css`, `Onboarding.tsx`.
- The hosted app has the same two rules; US-271 there drops them when it
  takes the package's stylesheet.

## Log

- 2026-09-20T19:25+08:00 — Opened. The owner asked why the sidebar logo
  looked wrong; the rounded clip was the cause, and the fix is to let the
  component own its style.
- 2026-09-20T19:32+08:00 — `theme.css` owns `.brand-logo`: `display: block`
  and `flex: 0 0 auto`, nothing else. The size is the `size` prop's width and
  height attributes; the onboarding page passes 40 and its stylesheet loses
  the rule that forced it. The open app's `index.css` loses the rule with the
  radius. `BrandLogo.test.tsx` renders the default and a given size;
  `theme.test.ts` reads the rule and fails on a radius, a clip or a size.
  Both failed under their mutations (radius back, size hard-coded) and pass
  now. `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`,
  `pnpm release:verify:ui` and the 447 package and web tests pass. Not
  rendered in a browser: the extension did not connect.
