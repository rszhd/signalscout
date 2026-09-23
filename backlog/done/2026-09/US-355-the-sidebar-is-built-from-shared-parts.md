---
id: US-355
title: The sidebar is built from shared parts
type: chore
priority: p3
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution: shipped
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

- [x] The owner confirmed the README's sentence may change; the Log says when.
- [x] `NavItem`, `NavIcon`, `AccountIdentity` and `SignOut` are exported from
      `@signalscout/ui` with the sidebar rules they need, taken from the
      hosted copy.
- [x] This application's `App.tsx` builds its sidebar and its account sheet
      from them; its tests pass unchanged but for imports.
- [x] The README's sentence about the navigation shell says what is shared
      and what stays.
- [x] Each part has stories (US-351).
- [ ] The sidebar and the phone's bottom bar were rendered in a browser.
      **As stories, not in the signed-in app.** The Chrome extension was
      disconnected, and headless Chrome has no session. Both products'
      sidebars and the phone bar were rendered in headless Chrome as
      stories with the same markup and the package stylesheet.
- [x] US-271 in the hosted repository names these parts.

## Notes

- `apps/web/src/App.tsx`, `styles/sidebar.css`, and the same in
  `signalscout-cloud`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
- 2026-09-23T15:31+08:00 — The owner answered: "the styling can be shared, but the hierachy of
  the navigation will be different". So the parts and the look are shared,
  and each application's shell keeps which items it shows, their order and
  their headings; the README says so in place of "a navigation shell belongs
  to each application".
- 2026-09-23T15:31+08:00 — Shipped. The parts are the hosted markup; the look is the hosted
  one, on its sidebar tokens. **Where the copies disagreed**: the hosted
  sidebar uses `--sidebar-text`, `--sidebar-muted` and `--sidebar-line` and
  colours the current item in the account sheet; this one used the general
  greys — the hosted answer was kept. `AccountIdentity` shows the full
  address on hover, as the hosted one does. Rules only one navigation needs
  stayed with it: *New monitor* here, moved from `index.css` into
  `styles/sidebar.css` so they still load after the package's `.nav-item`
  (otherwise its weight and its current colours would lose), with its one raw
  colour on `--surface-brand`. Dead rules in both went: a hidden `::before`
  bar on the current item, and a 1050px width a later rule always overrode.
  **A hosted bug, found on the way**: below 820px the hosted `sidebar.css`
  leaves `.site-nav` a flex column, so its bottom bar stacks the items; a
  test page built from its stylesheets put "Account" 68px under "Projects".
  The package rule is `display: grid`; US-271 there records it. `SignOut`
  also caught a refused sign-out, which left an unhandled rejection before
  (the reload happened either way). The other rules in `index.css`,
  `sidebar.css` and `login.css` are the same and in order. The shell's tests
  pass unchanged; 4 new; 2,388 pass.
