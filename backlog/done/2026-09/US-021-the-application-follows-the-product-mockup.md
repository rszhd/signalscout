---
id: US-021
title: The application follows the product mockup
type: feature
priority: p1
created: 2026-09-05T08:42+08:00
parent:
area: web
resolution: shipped
---

## Context

The working application and `mockup/` describe the same product with two
different visual systems. The mockup has the intended navigation, typography,
spacing, colour and responsive layout. The React application has the real
inbox, monitor form and monitor controls, but still presents them as separate
prototype pages.

The application should use the mockup as its visual source without claiming
features that the server does not provide. The provisional Signalbox name,
workspace switcher, account controls, saved matches, reply drafting,
connections and settings stay out until their own behaviour exists.

## Acceptance

- [x] The inbox, monitor list and monitor form share the mockup's application
      shell and visual system
- [x] Every existing action and state remains available, including inbox
      filters, pagination, monitor creation, pause and budget controls
- [x] Unsupported mockup actions are hidden rather than presented as working
- [x] The shell and all three screens remain usable at desktop and mobile
      widths
- [x] The web tests, typecheck, lint and production build pass
- [x] The inbox list and reading pane scroll vertically without moving each
      other on desktop
- [x] A post body longer than 80 words is collapsed behind a working read-more
      control
- [x] An inbox pane without overflow does not reserve or show a scrollbar
- [x] The IntentWatch wordmark uses the mockup's lime three-dot logo
- [x] New monitor opens in the mockup's dialog layout over the monitor list
      and can be dismissed without losing the application shell
- [x] The application uses Figtree for its interface typography
- [x] Reading text, labels, helper copy and metadata use a consistent scale;
      post bodies are 17px and informational text is never smaller than 12px
- [x] The shell, inbox panes, monitor cards and creation dialog use one clean,
      restrained theme with consistent spacing, radii and surface depth
- [x] Each inbox scrollbar sits directly on the pane edge without an inset
- [x] The inbox list and reading pane form one continuous workspace without
      an outer margin or gap between the columns
- [x] Application chrome uses a light neutral palette with a conventional
      blue interaction accent; product lime is confined to the logo and
      source marks retain their identifying colours

## Notes

- Visual source: `mockup/index.html` and `mockup/styles.css`.
- Behaviour source: the existing components and their jsdom tests in
  `apps/web/src/`.
- Keep the IntentWatch name. `mockup/README.md` says Signalbox is provisional.

## Log

- 2026-09-05T08:42+08:00 — Started the rebuild after agreeing that only
  implemented product behaviour should appear in the new shell.
- 2026-09-05T08:59+08:00 — Rebuilt the three screens around the mockup's
  navigation and visual language. The inbox now uses a compact list and a
  reading pane. Raised the small type after checking the real pages at desktop
  and mobile widths. All 31 web tests pass. The full suite passes all 390
  tests. Lint, typecheck and the production build pass.
- 2026-09-05T09:06+08:00 — Reopened to give the inbox list and reading pane
  independent vertical scroll areas.
- 2026-09-05T09:07+08:00 — Fixed the inbox to the viewport and gave both
  panes their own contained vertical overflow. Kept the mobile list and
  full-screen detail independently scrollable. Verified the two clipped panes
  in a 1440 by 700 browser viewport. The web tests, lint, typecheck and build
  pass.
- 2026-09-05T09:10+08:00 — Limited the reading pane to 80 words until the
  person selects Read more. Show less restores the same preview. The DOM test
  verifies the boundary and both actions. Verified the real long post in the
  browser. The inbox tests, lint, typecheck and build pass.
- 2026-09-05T09:12+08:00 — Removed the stable scrollbar gutter. Each inbox
  pane keeps automatic overflow, so its scrollbar appears only when its own
  content is taller than the pane.
- 2026-09-05T11:26+08:00 — Replaced the approximate orange bars with the
  mockup's lime speech-bubble mark and three offset dots. Kept the IntentWatch
  name. Verified the combined mark and wordmark in the browser.
- 2026-09-05T11:35+08:00 — Moved the two-stage monitor workflow into the
  mockup's modal layout over the monitor list. Added the close link, Escape
  handling and compact progress header. Verified the scrollable dialog at
  desktop and mobile widths.
- 2026-09-05T11:40+08:00 — Replaced Ubuntu with locally bundled Manrope at
  the three interface weights. Kept monospace labels unchanged.
- 2026-09-05T11:48+08:00 — Added a five-level type scale. Raised post bodies
  to 17px, regular copy to 15px, labels to 14px and secondary copy to at least
  12px. Darkened muted text, reduced form-label weight, loosened heading
  tracking and added space between form groups. Verified the inbox and monitor
  dialog at desktop and mobile widths.
- 2026-09-05T11:54+08:00 — Refined the visual system with warmer neutral
  surfaces, softer depth, consistent radii and quieter accents. Separated the
  inbox into two contained panes and centered the monitor grid. Removed the
  mobile filter overflow. Verified the inbox, monitors and creation dialog at
  desktop width, and the inbox at mobile width.
- 2026-09-05T12:00+08:00 — Put each inbox scroller inside its pane so the
  scrollbar has real space from both the content and panel edge. Kept
  automatic overflow, so the space does not force a scrollbar to appear.
- 2026-09-05T12:01+08:00 — Restored locally bundled Ubuntu at the requested
  three weights. Kept the larger type scale and all layout changes.
- 2026-09-05T12:10+08:00 — Replaced the dark, green and orange-led chrome
  with light neutral surfaces, muted blue actions and neutral source badges.
  Kept lime in the logo and kept warning and error colours semantic. Verified
  the inbox at desktop and mobile widths. The web tests, scoped lint,
  typecheck and production build pass. Repository-wide lint remains blocked
  by formatting in an unrelated uncommitted core test.
- 2026-09-05T12:13+08:00 — Restored Reddit orange on Reddit source marks.
  Kept orange out of the application chrome and action palette.
- 2026-09-05T12:51+08:00 — Replaced Ubuntu with locally bundled Inter at the
  three interface weights. Kept the established type scale and layout.
  Verified the inbox at desktop width. The web tests, scoped lint, typecheck
  and production build pass.
- 2026-09-05T12:59+08:00 — Removed the inbox workspace margin and column gap.
  Replaced the separate rounded panels with one divider while keeping both
  scroll regions independent.
- 2026-09-05T13:01+08:00 — Removed the inset around both inbox scrollbars so
  they sit directly on the pane edges. Verified the continuous desktop layout
  in the browser. The web tests, scoped lint, typecheck and production build
  pass.
- 2026-09-05T13:03+08:00 — Restored locally bundled Ubuntu after comparing it
  with Inter. Kept the established type scale and flush inbox layout. The web
  tests, scoped lint, typecheck and production build pass.
- 2026-09-05T16:23+08:00 — Replaced Ubuntu with locally bundled Figtree at
  weights 400, 500 and 700. The web production build and scoped lint pass.
