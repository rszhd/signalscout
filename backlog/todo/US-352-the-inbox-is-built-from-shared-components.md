---
id: US-352
title: The inbox is built from shared components
type: chore
priority: p2
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution:
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

- [ ] `MatchCard` (one list row) and `MatchDetail` (the reading pane: the
      source, the parent thread, the post, the score breakdown, the link
      caveat, the reasons, the save and verdict actions) are exported from
      `@signalscout/ui` with their stylesheet, taken from the hosted copy.
- [ ] `MonitoringBar` is exported; the link to the monitor is a prop.
- [ ] The words the inbox says about a match — where it came from, how deep
      its thread was read, the preview limit, the platform table — move to the
      package beside `band`, with their tests.
- [ ] *Copy link* and the minimum-score sentence stay on this screen, as
      optional props of the shared components.
- [ ] This application's `Inbox.tsx` renders them and deletes its copies; its
      tests pass unchanged but for imports.
- [ ] Each component has stories (US-351).
- [ ] The Log names each place the copies disagreed and which answer was kept.
- [ ] `pnpm lint:css` passes; no raw colour or spacing travels.
- [ ] The inbox was rendered in a browser after the change.
- [ ] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/Inbox.tsx`, `index.css` (the inbox rules), and the same in
  `signalscout-cloud`, whose inbox rules are in `styles/inbox.css` and
  `index.css`.
- Depends on US-351 for the stories.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
