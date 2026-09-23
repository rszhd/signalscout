---
id: US-353
title: The monitor screens share their parts
type: chore
priority: p2
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution:
---

## Context

The monitor detail page is two screens: five steps, a budget and a schedule
here, one guided flow with a plan allowance in the hosted product. Four of its
parts carry none of that and are one piece of markup in both applications:
the activity history (`MonitorHistory`), the search-input table
(`QueryPerformance`), the lead sources table (`LeadSources`), and the status
word with its colour, which four screens write by hand as
`<span className="monitor-status …">`.

The owner decided on 2026-09-23 that these move into `packages/ui`, the hosted
copy as the canonical one. The monitors table and the monitor form stay two
screens (US-277): one shows dollars, the other a share of an allowance.

## Acceptance

- [ ] `MonitorHistory`, `QueryPerformance`, `LeadSources` and `MonitorStatus`
      are exported from `@signalscout/ui` with their stylesheet, taken from
      the hosted copy.
- [ ] This application's screens render them and delete their copies; the
      tests pass unchanged but for imports.
- [ ] Each component has stories (US-351).
- [ ] The Log names each place the copies disagreed and which answer was kept.
- [ ] `pnpm lint:css` passes.
- [ ] The monitor page was rendered in a browser after the change.
- [ ] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/monitor.tsx`, `MonitorDetail.tsx`, `Monitors.tsx`, `Inbox.tsx`,
  `styles/monitors.css`, and the same in `signalscout-cloud`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
