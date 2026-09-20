---
id: US-274
title: The test harness is shared
type: chore
priority: p2
created: 2026-09-20T18:05+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

`apps/web/src/testing.tsx` is **byte-identical** in the two applications.
Measured on 2026-09-20: `diff` reports nothing. It is 158 lines of harness —
`mount` into a real document inside a `MemoryRouter`, `button` and `field` and
`select` by their label or their words, `setValue` through the native setter
React listens to, `settle`, and `json`.

Two copies of a harness is worse than two copies of a screen. A screen that
drifts shows a person something different; a harness that drifts makes the two
suites *mean* different things while every case still passes. The rule
`docs/testing.md` states — a screen is driven through the DOM a person uses —
is only one rule while there is one harness.

**It also unblocks something.** `packages/ui` has no way to render a component,
so `ProjectCard` (US-273) has no test of its own: it is covered through the open
application's projects page, and the hosted one will cover it again through
theirs. With the harness in the package, a shared component is tested where it
lives, once.

It goes beside the fixtures at `@signalscout/ui/testing`, which already ships
`monitor` and `poll`. That entry point is not in the published bundle a person
downloads — nothing a fixture or a harness knows belongs there — so this adds
no weight to either application.

`jsdom`, `react-dom` and `react` are what it needs. React is already a peer;
`jsdom` and `react-dom` become dev dependencies of the package and peers where
a consumer runs the harness.

## Acceptance

- [x] `@signalscout/ui/testing` exports `mount`, `button`, `field`, `select`,
      `setValue`, `settle`, `json` and the `Screen` type, beside the fixtures.
- [x] The open application's `testing.tsx` is deleted and every test file
      imports from the package.
- [x] `ProjectCard` has a test of its own in the package: the confirmation
      replacing the actions, the status line, and the second action slot.
- [x] The package's `vitest` environment is `jsdom` for that file only — the
      words' tests need no document and must not pay for one.
- [x] `ui-boundary.test.ts` still passes: `react-dom` is a dev dependency and
      a peer, `jsdom` a dev dependency only — the harness uses the document
      its environment gives it and never imports `jsdom` itself.
- [x] `pnpm release:verify:ui` proves the harness is not in the tarball's
      `dist/index.js` graph, and that `dist/testing` is.
- [x] `docs/testing.md` says the harness is the package's, and names the one
      place it lives.

## Notes

- `apps/web/src/testing.tsx`, `packages/ui/src/testing/`.
- `vitest.config.ts` — the include pattern already covers `packages/*/src`.
- The hosted repository's copy is identical today; US-271 there deletes it.
- 16 test files in the open application import it.

## Log

- 2026-09-20T18:05+08:00 — Written after a survey of what else the two
  applications hold twice. This was the only file with a diff of zero.
- 2026-09-20T18:40+08:00 — Shipped. `harness.tsx` moved with `git mv` into
  `packages/ui/src/testing/` and is exported beside the fixtures; 16 test
  files here import from the package. `ProjectCard` has six cases of its own,
  on `jsdom` for that file only. The packed verifier now refuses a main entry
  that reaches `react-dom` or `./testing` — proved by exporting `mount` from
  the entry point and watching it refuse. 2,260 tests pass, lint and typecheck
  pass, and the tarball installs and works outside the workspace. The cloud's
  copy is byte-identical, so US-271 deletes it and imports the same names.
