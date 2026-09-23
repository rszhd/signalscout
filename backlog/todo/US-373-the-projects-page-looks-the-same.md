---
id: US-373
title: The projects page and the project form look the same in both products
type: chore
priority: p2
created: 2026-09-23T16:35+08:00
parent: US-270
area: web
resolution:
---

## Context

The owner decided on 2026-09-23 that the two applications are identical in
styling, theme and branding, and differ only in features. A screen both
products have therefore looks the same in both, even where its features
differ; the difference is a prop or a slot, never a second stylesheet. A
count that day of the rules outside the package found this screen's
stylesheets still apart. `projects.css`: 53 the same, 9 different, 16 only hosted.

The method is US-352's: the hosted application's look is canonical, its
layers fold into one set of package rules with no page ancestor, raw values
move onto the tokens and the spacing scale, and the result is measured
against the hosted build's computed styles, not by eye. A rule that styles
a feature only one product has stays with that product.

## Acceptance

- [ ] Every element this screen shares with the hosted one takes its look
      from `@signalscout/ui`; this application's stylesheet keeps only
      layout and its own features' rules.
- [ ] A computed-style comparison against the hosted build, at desktop and
      phone widths, shows no difference but spacing moved onto the scale;
      the Log lists what differs and why.
- [ ] Parts with markup worth sharing are components with stories.
- [ ] This application's tests pass, or a changed one says why.
- [ ] `pnpm lint:css` passes.
- [ ] US-271 in the hosted repository says what to delete there.

## Notes

- `apps/web/src/styles/projects.css`, `Projects.tsx`, and the same in `signalscout-cloud`.
- Goes out with `ui-v0.2.0`, which waits for the owner.

## Log

- 2026-09-23T16:35+08:00 — Written after the owner's rule and the count, with US-371 to US-374.
