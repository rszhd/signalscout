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
