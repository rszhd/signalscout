---
id: US-279
title: One stylesheet export for the package
type: chore
priority: p2
created: 2026-09-20T18:40+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

Vite reads a dependency's `package.json` once and caches its `exports` map for
the life of the process. Everything else about the package reloads live — a
token, a component, a stylesheet — because the `development` condition points
at `src/`. But a **new export entry** does not, and the failure looks like a
crash: "not exported under the conditions …", an internal server error on
every request, until somebody restarts the dev server.

It happened three times on 2026-09-20, once per shared component that brought
a stylesheet of its own: `./project-card.css`, `./reply-voices.css`,
`./reply-draft.css`. Each was a new export, each needed a restart, and each
was reported as "5173 crash". The hosted application will meet the same thing
the day it adopts the package, for every component that ships with rules.

One export removes the case. `@signalscout/ui/styles.css` imports the tokens,
the theme and every component's rules, in that order. Adding a component then
adds a line inside a file Vite already watches — no new export, no restart.
The per-file exports go, so nothing can drift back to the shape that needs a
restart.

The trade: every application loads every shared component's rules, whether
its screens use the component or not. Today that is about 1,500 lines of CSS,
which is the size of one page stylesheet, and both applications use every
component in the package anyway.

## Acceptance

- [x] `@signalscout/ui/styles.css` exists and imports `tokens.css`,
      `theme.css`, and every component stylesheet, in that order.
- [x] It is the package's only stylesheet export; `./tokens.css`,
      `./theme.css` and the per-component exports are gone from `exports`
      and `publishConfig`.
- [x] The open application imports it once, where it imported `theme.css`,
      and its `index.css` no longer imports the tokens on its own.
- [x] The cascade is unchanged: tokens, then this application's base styles,
      then the shared theme and components, then the page stylesheets. The
      Log says how that was checked.
- [x] `pnpm release:verify:ui` proves `dist/styles/styles.css` is in the
      tarball and that it names every other stylesheet the tarball carries.
- [x] The README says: a component's rules are one line in `styles.css`, and
      an application imports one stylesheet.
- [x] US-271 in the hosted repository names the one import. (Added there in
      this ticket's commit.)

## Notes

- `packages/ui/package.json`, `src/styles/`, `scripts/verify-packed-ui.mjs`.
- `apps/web/src/main.tsx:6,7,17,18` and `index.css:5` are the five imports
  that become one.
- The restart rule this replaces is in the Log of US-273.

## Log

- 2026-09-20T18:40+08:00 — Written after the owner chose this over documenting
  the restart.
- 2026-09-20T18:50+08:00 — Shipped. The cascade check: the production bundle
  is the same 146,051 bytes before and after, with three blocks moved — the
  tokens, and the two screen stylesheets. For every selector defined on both
  the package's side and the application's, the relative order of the two
  definitions is what it was (the application's `index.css` before the
  package's rules, in both), and the three moved blocks have no competing
  selector on the other side: `:root` is the tokens' alone, and no page
  stylesheet names a `.reply-draft*` or `.reply-voice*` selector. Found on the
  way and left as found: `index.css` still carries `.project-row`,
  `.project-identity`, `.project-actions`, `.project-count`, `.project-name`
  and `.project-product` rules from before the projects page had its own
  stylesheet; they lose to the package today as they did yesterday, and they
  are dead. The verifier refuses a stylesheet in the tarball that
  `styles.css` does not import, proved by dropping one. After the restart
  this change needs — the last of its kind — a probe edit to a component's
  stylesheet reloaded live through `styles.css` with no restart.
