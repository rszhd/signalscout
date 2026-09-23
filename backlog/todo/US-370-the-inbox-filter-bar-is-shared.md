---
id: US-370
title: The inbox filter bar is shared
type: chore
priority: p2
created: 2026-09-23T16:13+08:00
parent: US-270
area: web
resolution:
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

- [ ] The filter bar — the Inbox/Saved switch, the monitor picker, the order,
      the Filters button and its panel — is exported from `@signalscout/ui`
      with its rules, taken from the hosted copy; the page passes values and
      callbacks, and the open panel is the bar's own state.
- [ ] The monitor picker shows only with more than one monitor, and only
      then counts in the Filters badge.
- [ ] The arrival banner, the list heading and *Show more* are exported too.
- [ ] The inbox's orders and score filters are the package's words, beside
      the match words (US-352).
- [ ] This application's `Inbox.tsx` renders them and deletes its copies;
      its tests pass unchanged but for imports, or a changed one says why.
- [ ] Each has stories.
- [ ] A browser shows the inbox's bar and heading the same as before, but
      for the hosted picker rule; the Log says how it was checked.
- [ ] US-271 in the hosted repository names them.

## Notes

- `apps/web/src/Inbox.tsx`, `index.css` (the `.inbox-toolbar`, `.filter`,
  `.inbox-extra-filters`, `.list-heading` and `.inbox-arrived` rules), and
  the same in `signalscout-cloud`, with its `styles/inbox.css`.
- Goes out with `ui-v0.2.0`, which waits for the owner.

## Log

- 2026-09-23T16:13+08:00 — Written after the owner said the filter bar
  still used its own component instead of one shared with the hosted app.
