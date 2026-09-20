---
id: US-276
title: A state block and an error row are components
type: chore
priority: p2
created: 2026-09-20T18:10+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

Two shapes are written by hand on nearly every screen, in both applications.
Counted on 2026-09-20:

| Shape | This application | Hosted |
|---|---|---|
| `center-state page-state` — loading, empty, failed | 17 | 11 |
| `form-error` — a refusal with the server's own sentence | 19 | 11 |

Fifty-eight hand-written copies of two shapes. They are not the same as each
other by accident: each is a mark, a heading, a sentence and sometimes one
action, and each was typed again on the screen that needed it. The cost shows
up as small disagreements — a heading on one and none on the next, an action
that is a button here and a link there, `role="status"` remembered on some and
forgotten on others, which is the one that matters to a screen reader.

`Button`, `Dialog` and `Field` are already components for exactly this reason
(US-099), and these two are the next. They are treatment with no product in
them: what a screen says while it waits, and what it says when the server
refused.

The accessible roles come with them, which is the real prize. A state block
that is still loading is `role="status"`; one that failed is `role="alert"`. A
screen should not have to remember which.

## Acceptance

- [x] `PageState` in `@signalscout/ui`: a mark, a heading, a sentence, an
      optional action, and the right role for `loading` / `empty` / `error`.
- [x] `FormError` in `@signalscout/ui`: the server's sentence, an optional
      retry, `role="alert"`.
- [x] Every `center-state page-state` and `form-error` in this application's
      screens is one of the two, or the Log says why it is not. One is not:
      the monitor form's success screen (`center-state success-state`) with
      its own ✓ mark, an eyebrow and a heading that names the monitor. It is a
      screen of its own rather than a state, and its mark stayed in
      `index.css` as the page's.
- [x] Their rules move out of the page stylesheets into the package, and
      `pnpm lint:css` still passes.
- [x] A test in the package covers the role each state carries, because that
      is the part a screen cannot be trusted to remember.
- [x] US-271 in the hosted repository names both components — it did already,
      from the survey that wrote this ticket.

## Notes

- Open: `Connections.tsx`, `MonitorDetail.tsx`, `Models.tsx`, `Monitors.tsx`,
  `Inbox.tsx`, `ReplyVoices.tsx`, `Providers.tsx`, `Projects.tsx`.
- The rules live in `apps/web/src/index.css` and the page stylesheets today.
- US-274 gives the package the harness this needs.
- US-099 is the same argument for a button, a field and a dialog.

## Log

- 2026-09-20T18:10+08:00 — Written after counting the hand-written copies:
  17 and 19 here, 11 and 11 hosted.
- 2026-09-20T19:30+08:00 — Shipped. `PageState` (loading / empty / error, the
  role decided by the kind, `page={false}` for a notice inside a screen) and
  `FormError` (a line, or a row with the action at the end). Their rules moved
  from this application's `index.css` into the package's `theme.css` on
  tokens, with `--danger-soft` added; the success mark stayed behind as the
  page's own. Sixteen state blocks and nineteen error rows here are the two
  components now — the disagreements they carried are gone: two blocks with
  no role, a spinner that was a `div` on some screens, an error icon on some
  and not others, and "Try again" that was primary here and secondary there
  (each screen kept its own button; the block no longer cares). Seven cases
  in the package; making an error `status` turned one red. 2,269 tests pass
  and the tarball installs and works outside the workspace. No browser has
  rendered the blocks.
