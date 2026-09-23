---
id: US-353
title: The monitor screens share their parts
type: chore
priority: p2
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution: shipped
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

- [x] `MonitorHistory`, `QueryPerformance`, `LeadSources` and `MonitorStatus`
      are exported from `@signalscout/ui` with their stylesheet, taken from
      the hosted copy.
      **The markup and the look are the hosted copy's; the fetching is not
      shared**, because the two APIs answer these reads in different shapes.
- [x] This application's screens render them and delete their copies; the
      tests pass unchanged but for imports.
- [x] Each component has stories (US-351).
- [x] The Log names each place the copies disagreed and which answer was kept.
- [x] `pnpm lint:css` passes.
- [x] The monitor page was rendered in a browser after the change.
- [x] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/monitor.tsx`, `MonitorDetail.tsx`, `Monitors.tsx`, `Inbox.tsx`,
  `styles/monitors.css`, and the same in `signalscout-cloud`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
- 2026-09-23T14:56+08:00 — Shipped. **The two copies had moved further apart than the inbox**,
  and each difference became a prop or stayed with its page:
  - The APIs differ. Hosted, `activity` sends a bare list and `queries` a
    list; here they send `{entries, stagesRecordedSince, more}` and
    `{floor, inputs}`, and `leads` adds `floor` and a `label` per group. So
    no part fetches: each page keeps its request and hands the rows in, and
    the extra fields are optional.
  - The history: this application pages it and says where the stage record
    ends (US-266); hosted does neither. Kept as `more`, `onShowOlder` and
    `stagesRecordedSince`. The open loader is now `MonitorActivity`.
  - The query table: "Never matched" / "No match in 30 days" is only here —
    the `note` prop. The hosted table's sentence replaced this one's ("A
    phrase that finds posts and never a match is paying for every poll").
  - The lead groups: hosted dropped "posts vs. comments" on purpose; this
    application keeps it through `dimensions`. The default is the hosted
    three, and the labels are the hosted ones ("Platforms", "Intent").
    Whether this application should drop the group is the owner's call.
  - Around the tables: a tab panel hosted, a titled section with the score
    floor here. The heading stays each page's.
  - The status word: the hosted pill with a dot, on every screen. A stopped
    monitor is `--danger` on `--danger-soft`; the bar said it in
    `--warning`, and now uses `MonitorStatus` too.
  - `.monitor-origin` and `.budget-error` moved to the theme, because the
    parts use them; `#923e2c` became `--danger`.
  - The tables name their roles, as `docs/design.md` requires of a table
    that becomes cards on a phone. The hosted copy did not.
  **Checked**: the rules left in `index.css` and `monitors.css` are the same
  and in the same order (345 and 188 rules). Browser: the monitor page on
  `dev` and on this branch — history, search performance, lead sources — the
  query table in a 390px frame, and the list's status pill. The 22 new
  stories render. The monitor tests pass unchanged; 12 new; 2,375 pass.
- 2026-09-23T15:56+08:00 — The owner answered the open question: this application keeps
  "Posts vs. comments" among its lead groups. It stays a `dimensions` prop
  here and out of the hosted default.

