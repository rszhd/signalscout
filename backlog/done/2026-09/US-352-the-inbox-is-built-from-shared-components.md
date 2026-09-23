---
id: US-352
title: The inbox is built from shared components
type: chore
priority: p2
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

The two `Inbox.tsx` files are 1,260 and 1,240 lines, and the list row, the
reading pane and the monitoring bar are the same markup in both. The owner
decided on 2026-09-23 that the pieces the two products share move into
`packages/ui`, the hosted copy as the canonical one.

The inbox as a whole stays each application's: it holds the filters, the
paging, the address and the requests. What moves is the parts it renders.

**This application's copy is newer in two places**: the *Copy link* action on
the reading pane and the sentence that names the monitors' minimum score. They
survive as options, not as a fork, so the hosted product can take them later.

## Acceptance

- [x] `MatchCard` (one list row) and `MatchDetail` (the reading pane: the
      source, the parent thread, the post, the score breakdown, the link
      caveat, the reasons, the save and verdict actions) are exported from
      `@signalscout/ui` with their stylesheet, taken from the hosted copy.
- [x] `MonitoringBar` is exported; the link to the monitor is a prop.
- [x] The words the inbox says about a match — where it came from, how deep
      its thread was read, the preview limit, the platform table — move to the
      package beside `band`, with their tests.
- [x] *Copy link* and the minimum-score sentence stay on this screen, as
      optional props of the shared components.
      **Copy link is the `actions` slot. The sentence is not a prop**: it is
      in the empty state, which is the page's, because no shared part shows
      an inbox with nothing in it.
- [x] This application's `Inbox.tsx` renders them and deletes its copies; its
      tests pass unchanged but for imports.
- [x] Each component has stories (US-351).
- [x] The Log names each place the copies disagreed and which answer was kept.
- [x] `pnpm lint:css` passes; no raw colour or spacing travels.
- [x] The inbox was rendered in a browser after the change.
- [x] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/Inbox.tsx`, `index.css` (the inbox rules), and the same in
  `signalscout-cloud`, whose inbox rules are in `styles/inbox.css` and
  `index.css`.
- Depends on US-351 for the stories.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
- 2026-09-23T14:34+08:00 — Shipped. The parts are the hosted markup, which matched this
  application's line for line except *Copy link*; the words were identical.
  **Where the copies disagreed**, the hosted answer was kept except where
  noted: the monitoring bar's link (this app opens the monitor, the hosted
  one the list — now a prop); *Copy link* (only here — the `actions` slot);
  the look (the hosted `inbox.css` layer over both apps' shared `index.css`
  rules: pill-shaped badges and verdict buttons, a blue inset edge on the
  selected row, grey panels for the score and the reasons, a check on the
  chosen verdict, blue score bars, and a pill with a blinking dot for the
  status in the bar). The two layers became one `match.css` with no
  `.inbox-page` ancestor. **Raw values moved to tokens**: the title
  `#222624` is `--ink`; `#687069`, `#6b706c`, `#59615b` and the bullet
  `#8b938d` are `--muted` (the bullet darkens); `#374039` and `#3a403b` are
  `--muted-strong`; the reply's thread background `#fbfbfa` is
  `--surface-soft`; about thirty spacing values moved to the nearest step.
  The bar's status states every property itself, because `.monitor-status`
  still belongs to the monitor screens until US-353. `.visually-hidden`
  moved to the theme, since `MatchCard` needs it; three `.source-dot` rules
  no element used were deleted. The removal from `index.css` was checked by
  script: the other 352 rules are the same, in the same order. Browser: the
  inbox on `dev` and on this branch side by side, the pane's lower half, and
  a 390px frame (the list, the pane over it, the back button, no sideways
  scroll); all 23 new stories render, each opened in its own frame. The inbox tests pass unchanged;
  `match.test.ts` and `MatchDetail.test.tsx` add 19; 2,363 pass.
