---
id: US-110
title: Constrained pages share one content width
type: chore
priority: p2
created: 2026-09-10T15:10+08:00
area: web
resolution: shipped
---

## Context

Constrained pages used several different maximum widths. Their content edges
moved when the navigation did not. The intent inbox is the deliberate exception:
its list and reading pane use the full space beside the navigation.

## Acceptance

- [x] One shared token sets the outer content width for constrained application pages.
- [x] The intent inbox keeps its full-width list and detail layout.
- [x] Existing page gutters still keep content clear of phone edges.
- [x] The web typecheck and production build pass.

## Notes

- `apps/web/src/styles/tokens.css` owns shared page sizing.
- Presentation-only CSS does not need a test that asserts the width value.

## Log

- 2026-09-10T15:10+08:00 — Started from the full-width inbox reported on `/projects/:id`.
- 2026-09-10T15:12+08:00 — Set one 1240px boundary, constrained the inbox, and passed 338 web tests, lint, typecheck and the production build.
- 2026-09-10T15:40+08:00 — Restored the inbox to full width on the owner's decision and kept the shared boundary for every constrained page.
