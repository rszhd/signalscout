---
id: US-376
title: A key figure that wraps to a second row keeps its border
type: bug
priority: p2
created: 2026-09-23T16:53+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-371 took the hosted rules for the monitor page's key figures. The hosted
page has two figures and the grid has two columns. This application's page
has three, so "Budget left" wraps to a second row, and there it had no line
above it and filled only half the row. The owner saw it on 2026-09-23. The
hosted page does not show it, because it never has a second row.

## Acceptance

- [x] A figure on a second row has a line above it.
- [x] A figure alone on its row spans the row, so the line is full width.
- [x] A figure that starts a row loses its left line where the first one does.
- [x] The package's tests and `pnpm lint:css` pass.

## Notes

- `packages/ui/src/styles/monitor-screens.css`.

## Log

- 2026-09-23T16:53+08:00 — Done. Checked in screenshots at 1300, 900 and 390 px, with the
  page's markup in the Storybook frame, which loads the package styles.
