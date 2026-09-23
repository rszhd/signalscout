---
id: US-370
title: The inbox filter bar is shared
type: chore
priority: p2
created: 2026-09-23T16:13+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-352 moved the inbox's list row, reading pane and monitoring bar into the
package and left the rest of the inbox with each application, on the reading
that the filters carry the product. The owner looked and disagreed: the
filter bar is the same bar in both. It is — the markup differs by one line,
and the hosted rule there is the better one: the monitor picker is shown only
when a project has more than one monitor, because a choice of one narrows
nothing and counted itself in the Filters badge.

Three more pieces around the list are identical in both applications and go
with it: the banner that says new matches arrived, the list heading (the
count, the order, *Export CSV*) and *Show more*.

What stays each application's: the state behind the bar, the requests, the
address, and the empty states.

## Acceptance

- [x] The filter bar — the Inbox/Saved switch, the monitor picker, the order,
      the Filters button and its panel — is exported from `@signalscout/ui`
      with its rules, taken from the hosted copy; the page passes values and
      callbacks, and the open panel is the bar's own state.
- [x] The monitor picker shows only with more than one monitor, and only
      then counts in the Filters badge.
- [x] The arrival banner, the list heading and *Show more* are exported too.
- [x] The inbox's orders and score filters are the package's words, beside
      the match words (US-352).
- [x] This application's `Inbox.tsx` renders them and deletes its copies;
      its tests pass unchanged but for imports, or a changed one says why.
- [x] Each has stories.
- [x] A browser shows the inbox's bar and heading the same as before, but
      for the hosted picker rule; the Log says how it was checked.
- [x] US-271 in the hosted repository names them.

## Notes

- `apps/web/src/Inbox.tsx`, `index.css` (the `.inbox-toolbar`, `.filter`,
  `.inbox-extra-filters`, `.list-heading` and `.inbox-arrived` rules), and
  the same in `signalscout-cloud`, with its `styles/inbox.css`.
- Goes out with `ui-v0.2.0`, which waits for the owner.

## Log

- 2026-09-23T16:13+08:00 — Written after the owner said the filter bar
  still used its own component instead of one shared with the hosted app.
- 2026-09-23T16:25+08:00 — Shipped. The parts are the hosted markup; the only difference in it
  was the picker rule, and the hosted one was kept. One test here changed
  for it: "offers only the monitors of the project" gave the project one
  monitor, which now shows no picker, so it has two; a new case asserts a
  single monitor shows none and does not count in the badge. The look is
  the hosted `inbox.css` folded into the shared rules, with two of its rules
  left out because a stronger rule always overrode them (a 440px gap on the
  switch and a 9px pad on the Filters button). **Checked** by rendering the
  same frame with each application's built CSS and comparing every
  element's computed box and type at 390, 560, 700 and 1400px, the widths
  set exactly through Chrome's device emulation: colours, fonts, radii and
  borders match everywhere; what differs is spacing moved onto the scale —
  the select's 30/10px padding is 32/8, the panel label's 5px margin 4,
  *Clear filters*' 5px padding 4, *Show more*'s 18px 20, and at 440px and
  below the toolbar's 14px sides 16. The first run found two more, both
  fixed: the 441–600px toolbar kept its 20px sides in the hosted app, and
  the Filters button keeps 12px below 440px. 2,413 tests pass.
- 2026-09-23T16:25+08:00 — The owner saw extra space on the right of a dialog, and the same
  branch removed it: `.app-dialog` reserved a 15px scrollbar gutter; 0px
  after, measured on an open dialog.

