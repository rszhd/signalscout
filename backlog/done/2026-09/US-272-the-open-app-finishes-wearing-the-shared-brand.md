---
id: US-272
title: The open app finishes wearing the shared brand
type: chore
priority: p3
created: 2026-09-20T12:10+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

US-270 made a raw colour a lint error, so that two applications can wear one
brand: a control names `var(--accent)` and never the hex behind it. Two page
stylesheets could not pass it and are exempt in `stylelint.config.mjs` —
`reply-draft.css` and `reply-voices.css`. They carry a whole palette the brand
does not have: greens (`#52634e`, `#64765f`, `#d9e1d6`), ambers (`#ead8b7`,
`#77542f`, `#fff8e9`), blues of their own (`#dbe4f2`) and four shadows written
as `rgb()`.

That is about a dozen values on two pages. Naming each one a brand token
would be worse than the debt — the brand would gain a green it does not use
anywhere else — so the work is to adopt the palette these pages predate, which
is a visual change to the reply composer and the voice editor rather than a
rename.

The exemption list in `stylelint.config.mjs` is one part of what this ticket
deletes. The first pass stopped there and was rejected: the open app still
used its old sidebar treatment, the shared component redrew the logo instead
of using the canonical mark file, and `index.html` still linked the old radar
favicon. Those are the most visible brand surfaces. Completion means comparing
the application shell and browser assets with the hosted app, not merely
making two page stylesheets pass lint.

## Acceptance

- [x] `reply-draft.css` and `reply-voices.css` name only tokens.
- [x] The `overrides` entry for the two files is gone from
      `stylelint.config.mjs`, and `pnpm lint:css` passes without it.
- [x] No value moved into `packages/ui`'s tokens that only one page uses.
- [x] Both screens were rendered in a browser and the Log says what changed.
- [x] Desktop sidebar and phone navigation use the hosted app's spacing,
      surfaces, selection treatment and account treatment while retaining the
      open app's own destinations.
- [x] `BrandLogo` renders the canonical mark and the open app ships the same
      mark, favicon, touch icon and web-app icons as the hosted app.
- [x] `index.html` names the hosted theme colour and links the canonical icon
      and manifest set; no browser entry point links the old radar mark.
- [x] The shell, logo and browser metadata have regression coverage, and every
      route is rendered again at desktop and phone widths.

## Notes

- `apps/web/src/styles/reply-draft.css`, `styles/reply-voices.css`.
- `packages/ui/src/styles/tokens.css` — the palette to adopt.
- The hosted application has the same two files and the same debt; US-271
  there pins the package, and this ticket is a candidate to do in both.
- Hosted references: `apps/web/src/styles/sidebar.css`, `BrandLogo.tsx`,
  `index.html` and `public/brand/` in `signalscout-cloud`.

## Log

- 2026-09-20T12:10+08:00 — Split out of US-270, which made the rule and found
  these two files could not meet it.
- 2026-09-20T14:38+08:00 — Adopted the shared palette without adding a token.
  The reply composer lost its gradient and decorative shadows. Its focus,
  warning, success and modal states now use the theme's semantic tokens. The
  voice editor returned to flat reading surfaces, lighter headings and the
  same blue selection treatment as the rest of the application. The two raw
  colour exemptions are gone. Both screens were rendered at 1440 by 1000 and
  375 by 812. The composer included a completed draft, warning and copied
  state; the voice editor included saved voices and its editor. Neither page
  overflowed horizontally.
- 2026-09-20T14:45+08:00 — `pnpm lint`, `pnpm lint:css`, `pnpm typecheck`,
  `pnpm build`, `pnpm release:verify:ui` and all 2,247 tests pass. The first
  suite run was inside the filesystem sandbox and could not open Postgres or
  localhost sockets; the same suite passed with that local access enabled.
- 2026-09-20T14:49+08:00 — Reopened after owner review. Passing the palette
  rule was not completion: the sidebar, canonical mark and browser icons still
  visibly differed from the hosted brand. Expanded acceptance to cover those
  surfaces and the page-by-page browser comparison they require.
- 2026-09-20T15:17+08:00 — Ported the hosted shell into a dedicated
  `sidebar.css`: the 240-pixel quiet rail, borderless chrome, 999-pixel active
  pills, 32-pixel icon cells, account divider and account identity treatment
  now match. The phone shell is an 80-pixel four-destination grid; its active
  destination is the same blue icon pill as cloud. One semantic correction
  came from the browser pass: monitor setup, detail and notifications keep
  Monitors current, while Providers, Voices and Models make Account current.
  The open app retains its project-scoped destinations and its desktop New
  monitor link.
- 2026-09-20T15:17+08:00 — Replaced the redrawn JSX mark and old radar
  favicon with the hosted canonical files. `@signalscout/ui` now publishes the
  nine-dot and small cuts; the app serves that mark, the three PNG variants,
  Apple touch icon, ICO and manifest. `index.html` uses the hosted theme colour
  and links the complete set. Asset parity and browser metadata have a test.
  The legacy `logo.png`, retained for the email ticket, is now the canonical
  512-pixel raster instead of the old artwork.
- 2026-09-20T15:17+08:00 — Rendered all 12 application routes at 1440 by 1000
  and 375 by 812 with a disposable local account. Every route decoded the
  130-pixel canonical mark, used the `#f8fafd` shell, kept the correct selected
  section, and had no horizontal page overflow. The favicon, mark and manifest
  each returned 200 in the browser. The audit account and all nine rows it
  created were removed afterward. `pnpm lint`, `pnpm lint:css`,
  `pnpm typecheck`, `pnpm build`, `pnpm release:verify:ui` and all 2,251 tests
  pass.
