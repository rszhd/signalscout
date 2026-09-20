---
id: US-282
title: The open app sets type the way the hosted app does
type: chore
priority: p3
created: 2026-09-20T19:12+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-270 gave both applications one type scale: `tokens.css` names the family
and the sizes, and `theme.css` sets the controls and the page title. The page
stylesheets under `apps/web/src/styles` were left as they were, and they still
set type the way the open app did before the split: section headings at
`1.25rem` and weight 600 with `-0.02em` tracking, names and counts in tables
at 600, the login eyebrow in uppercase, dialog titles at the browser's bold.

The hosted app moved on. Its body text carries `-0.006em` tracking. A section
heading is `--text-md` at weight 500. A name, a count or a strong term inside
a table or a list is weight 500. A hero heading (setup, login story) is
weight 500. The login eyebrow is a plain accent line, not uppercase. The
result is a lighter page where weight marks hierarchy once, not twice.

Measured over `index.css` and `styles/*.css`: 221 selectors set type in both
apps and 19 of them disagree; the open app has a further 86 selectors on
pages the hosted app does not have (providers, connections, models, jobs),
and those follow the old convention. The owner's rule from US-274 stands:
the hosted copy is the canonical one.

## Acceptance

- [x] Every selector that both apps set disagrees on no typography
      property (`font-size`, `font-weight`, `letter-spacing`, `line-height`,
      `text-transform`).
- [x] The open-only pages follow the hosted conventions: section headings at
      `--text-md` and weight 500, names and strong terms in tables and lists
      at 500, dialog titles at 500, table heads at `--text-xs` and 500 with
      no added tracking.
- [x] No page stylesheet gains a raw font size that the hosted app does not
      use for the same role.
- [x] `pnpm lint:css`, `pnpm lint`, `pnpm typecheck` and the web tests pass.
- [x] The Log names each rule that changed and what it changed to.

## Notes

- Measure with the script in the Log; it flattens media queries, so a value
  that a breakpoint overrides reads as the override.
- `.trial-badge` has no markup in the open app (the trial is a hosted
  concept); it goes rather than follows.
- `.success-mark` is a glyph at 700; it is not text and keeps its weight.
- Hosted references: `styles/monitors.css` (overview h2, group heading,
  table name, found count), `styles/login.css` (eyebrow, story h2, card h1),
  `styles/projects.css` (list heading), `styles/notifications.css` (legend),
  `index.css` (body).

## Log

- 2026-09-20T19:12+08:00 — Opened after the owner asked that "font usage,
  sizing, weight, formatting should follow cloud".
- 2026-09-20T19:15+08:00 — Nineteen shared rules now carry the hosted
  values. `body` gains `-0.006em` tracking. `.brand` and `.login-brand` are
  `1.0625rem` at `-0.015em`. `.login-eyebrow` drops uppercase and the
  `0.06em` tracking and sits at 500. `.login-story h2`, `.login-card h1`,
  `.login-story-points strong`, `.setup-heading h2` (now `-0.02em`),
  `.monitor-table-name`, `.monitor-table-found > strong` and
  `.project-empty h2` are 500. `.monitors-overview h2`,
  `.notification-panel legend` and `.project-list-heading h2` (now
  `-0.01em`) are `--text-md` at 500; `.monitor-group-heading` is
  `--text-label` at 500. `.project-list-heading span` and the notification
  status lines take the hosted line heights. The detail tabs' button reads
  `font: inherit` before its size and weight, as the hosted rule does.
- 2026-09-20T19:15+08:00 — The open-only pages follow the same
  conventions. Section headings on connections, models and providers
  (`.connections-section-heading h2`, `.models-section-heading h2`,
  `.providers-platform-header h2`, `.providers-overview-copy h2`) are
  `--text-md` at 500. The two dialog titles are 500 instead of the browser's
  bold. `.connection-avatar`, `.connection-identity strong`,
  `.provider-option strong`, `.connections-empty h3` and `.job-tip-label`
  are 500. `.providers-table thead th` loses its `0.02em` tracking.
  `.trial-badge` had no markup here and is removed. `.success-mark` keeps
  700; it is a glyph.
- 2026-09-20T19:15+08:00 — Re-measured: 219 selectors set type in both
  apps and none disagree. `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`
  and the 350 web tests pass. The browser extension did not connect, so no
  screen was rendered; that pass is owed with the ones from US-270,
  US-273, US-277, US-278 and US-281.
