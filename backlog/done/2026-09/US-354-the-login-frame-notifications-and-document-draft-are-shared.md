---
id: US-354
title: The login frame, the notification settings and the document draft are shared
type: chore
priority: p3
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

Three more pieces are the same in both products, and the owner decided on
2026-09-23 that they move into `packages/ui`, the hosted copy as the canonical
one.

- **`LoginFrame`**: the brand panel around the sign-in form. The form inside
  stays each application's: first run and open sign-up here, a password reset
  hosted.
- **`Notifications`**: a monitor's digest, email and webhook settings. This
  application also tells a person when the webhook is signed with the
  instance's own `WEBHOOK_SIGNING_SECRET`; that notice is a slot.
- **`DraftFromDocument`**: the project form's "fill this in from a file".

## Acceptance

- [x] The three are exported from `@signalscout/ui` with their stylesheets,
      taken from the hosted copy.
- [x] The instance signing-secret notice stays on this application's screen,
      through a slot.
- [x] This application renders them and deletes its copies; the tests pass
      unchanged but for imports.
- [x] Each has stories (US-351).
- [x] The Log names each place the copies disagreed and which answer was kept.
- [x] `pnpm lint:css` passes.
- [ ] The login, notifications and project form screens were rendered in a
      browser after the change.
      **The login page was; the other two were not on the app.** The Chrome
      extension disconnected mid-ticket, and headless Chrome has no session.
      Both were rendered in headless Chrome as package stories instead, with
      the same component and stylesheet; the app's own tests pass.
- [x] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/Login.tsx`, `Notifications.tsx`, `Projects.tsx`,
  `styles/login.css`, `styles/notifications.css`, and in `signalscout-cloud`
  also `DraftFromDocument.tsx`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
- 2026-09-23T15:11+08:00 — Shipped, with the browser box above half done. **Where the copies
  disagreed**, the hosted answer was kept except where noted:
  - `LoginFrame`: the same markup. This application adds a line under the
    story ("Your accounts. Your API keys. Your data.") and says
    "Open-source AI intent monitoring." in the footer — `storyNote` and
    `footer`. The look is the hosted one: the story panel is flat, with no
    border or shadow, and the page padding is `--page-gutter`.
  - `Notifications`: the hosted screen — a breadcrumb to the monitor, a
    two-column digest, a save bar, a panel for the secret, and `Field`
    throughout. This one's header said "Monitor settings" and went back to
    the monitor list; it now goes back to the monitor, which is the page
    that links here. What only this API sends is optional: `canStore` and
    `storeBlocker` are shown whenever they come, and the instance-secret
    sentence is `signingNotice`. The whole hosted `notifications.css` moved,
    and this one's was deleted.
  - `DraftFromDocument`: the code was identical. Each page overrode the base
    rules the same way, so the package holds that shared look and each page
    keeps the space it gives the part; the project editor's own input
    radius went, for the hosted 4px.
  **Checked**: the rules left in `login.css`, `index.css` and `projects.css`
  are the same and in order. Headless Chrome: the signed-out login on this
  branch at desktop and phone width, and all 13 new stories (no error
  screen; screenshots of the notification screen at both widths and of the
  draft's refusal after its play steps ran). The `dev` server on 5173 could
  not serve the "before" login: its Vite process holds the package's exports
  from before US-353 and throws on `MonitorHistory` until it restarts. The
  screens' tests pass unchanged; 9 new; 2,384 pass.
