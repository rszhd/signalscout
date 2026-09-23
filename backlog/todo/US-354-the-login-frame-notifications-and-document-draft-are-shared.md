---
id: US-354
title: The login frame, the notification settings and the document draft are shared
type: chore
priority: p3
created: 2026-09-23T13:51+08:00
parent: US-270
area: web
resolution:
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

- [ ] The three are exported from `@signalscout/ui` with their stylesheets,
      taken from the hosted copy.
- [ ] The instance signing-secret notice stays on this application's screen,
      through a slot.
- [ ] This application renders them and deletes its copies; the tests pass
      unchanged but for imports.
- [ ] Each has stories (US-351).
- [ ] The Log names each place the copies disagreed and which answer was kept.
- [ ] `pnpm lint:css` passes.
- [ ] The login, notifications and project form screens were rendered in a
      browser after the change.
- [ ] US-271 in the hosted repository names these components.

## Notes

- `apps/web/src/Login.tsx`, `Notifications.tsx`, `Projects.tsx`,
  `styles/login.css`, `styles/notifications.css`, and in `signalscout-cloud`
  also `DraftFromDocument.tsx`.
- Depends on US-351.

## Log

- 2026-09-23T13:51+08:00 — Written after the survey, with US-351.
