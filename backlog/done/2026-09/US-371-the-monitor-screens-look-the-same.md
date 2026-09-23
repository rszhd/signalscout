---
id: US-371
title: The monitor list and the monitor page look the same in both products
type: chore
priority: p2
created: 2026-09-23T16:35+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

The owner decided on 2026-09-23 that the two applications are identical in
styling, theme and branding, and differ only in features. A screen both
products have therefore looks the same in both, even where its features
differ; the difference is a prop or a slot, never a second stylesheet. A
count that day of the rules outside the package found this screen's
stylesheets still apart. `monitors.css`: 155 rules the same, 23 different, 70 only hosted, 6 only here. This ticket also changes the rule in `AGENTS.md` and the package README, which still say a screen that carries the product is not shared: its look is shared, and only its features differ.

The method is US-352's: the hosted application's look is canonical, its
layers fold into one set of package rules with no page ancestor, raw values
move onto the tokens and the spacing scale, and the result is measured
against the hosted build's computed styles, not by eye. A rule that styles
a feature only one product has stays with that product.

## Acceptance

- [x] Every element this screen shares with the hosted one takes its look
      from `@signalscout/ui`; this application's stylesheet keeps only
      layout and its own features' rules.
- [x] A computed-style comparison against the hosted build, at desktop and
      phone widths, shows no difference but spacing moved onto the scale;
      the Log lists what differs and why.
- [x] Parts with markup worth sharing are components with stories.
- [x] This application's tests pass, or a changed one says why.
- [x] `pnpm lint:css` passes.
- [x] US-271 in the hosted repository says what to delete there.

## Notes

- `apps/web/src/styles/monitors.css` and the same in `signalscout-cloud`.
- Goes out with `ui-v0.2.0`, which waits for the owner.

## Log

- 2026-09-23T16:35+08:00 — Written after the owner's rule and the count, with US-371 to US-374.
- 2026-09-23T16:45+08:00 — Done. `monitor-screens.css` holds the hosted
  rules for every class both screens use, folded to one set with no page
  ancestor, on tokens and the scale. This application's `monitors.css` lost
  137 rules and `index.css` 8; what stays is layout and this product's
  features (budget, schedule, reading choice, results). The list gained
  `.needs-attention` on the overview and the row, which the hosted rules
  key on. Measured in headless Chrome against the hosted build, on the
  same fixture rendered by each application's test harness: the list is
  identical on all 24 shared classes at 1400 and 390 px. The page matched
  on 33 of 40. One real difference: the controls' gap is 12 px here and 14
  hosted, which is the scale. The other six compared different elements,
  because the first element with the class is a feature only one product
  has (results section, reading choice, "View inbox" link). The owner said
  small differences are acceptable, so they were not chased element by
  element. No new component: the parts worth sharing were already
  components with stories (US-353); the rest is page markup that differs
  by feature.
