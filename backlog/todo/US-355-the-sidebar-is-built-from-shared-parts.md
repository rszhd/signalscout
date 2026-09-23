---
id: US-355
title: The sidebar is built from shared parts
type: chore
priority: p3
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution:
---

## Context

**This moves a line US-270 drew**, and the package README says it: "a
navigation shell belongs to each application". The owner asked on 2026-09-23
for most of the screens to be built from shared components, and the sidebar is
where the two applications look most alike and are written twice.

The line moves only part of the way. What each application shows stays its
own: the items, their order, their addresses, the trial badge hosted, the
Providers and Models items here. What moves is the parts the items are built
from: `NavItem` (an icon, a label, `aria-current`), `NavIcon` and its paths,
`AccountIdentity` (the avatar letter, the name and the email) and `SignOut`.

**Confirm with the owner before starting.** The survey proposed this one as
conditional on a yes to moving the line, and the answer on 2026-09-23 did not
say it by name.

## Acceptance

- [ ] The owner confirmed the README's sentence may change; the Log says when.
- [ ] `NavItem`, `NavIcon`, `AccountIdentity` and `SignOut` are exported from
      `@signalscout/ui` with the sidebar rules they need, taken from the
      hosted copy.
- [ ] This application's `App.tsx` builds its sidebar and its account sheet
      from them; its tests pass unchanged but for imports.
- [ ] The README's sentence about the navigation shell says what is shared
      and what stays.
- [ ] Each part has stories (US-351).
- [ ] The sidebar and the phone's bottom bar were rendered in a browser.
- [ ] US-271 in the hosted repository names these parts.

## Notes

- `apps/web/src/App.tsx`, `styles/sidebar.css`, and the same in
  `signalscout-cloud`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
