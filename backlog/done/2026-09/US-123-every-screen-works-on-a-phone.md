---
id: US-123
title: Every screen works on a phone
type: chore
priority: p2
created: 2026-09-11T18:08+08:00
parent:
area: web
resolution: shipped
---

## Context

`docs/design.md` already carries the rule: at 820px and below the navigation
moves to the bottom, and a layout must work at 320px without horizontal page
scrolling. Most stylesheets have media queries that say they follow it.

Nobody has checked. AGENTS.md names "screens no browser has rendered" as a
standing gap, and that is exactly what the phone width is: the breakpoints
were written from reasoning about the markup, not from looking at the page.
A rule that has never been rendered is a claim, not a measurement.

This ticket renders every screen at phone width in a real browser and fixes
what breaks. It is presentation only. No route, no data shape and no API call
changes.

Two widths are checked, because they fail differently:

- **390px** — the common phone. The question is whether the screen is
  comfortable: tap targets, wrapping, reading width, whether the bottom
  navigation covers content.
- **320px** — the smallest width the design document promises. The question is
  only whether it breaks: horizontal page scroll, clipped text, a control
  pushed off the edge.

The work is one screen at a time. A screen is done when both widths are seen
and its defects are fixed, not when its stylesheet has a media query.

## Acceptance

Each screen below is rendered at 390px and at 320px, defects are fixed, and
neither width scrolls the page sideways.

- [x] Login
- [x] Projects
- [x] Project form (new and edit)
- [x] Inbox
- [x] Monitors
- [x] New monitor (all five steps)
- [x] Monitor detail
- [x] Notifications
- [x] Connections
- [x] Providers
- [x] Models
- [x] Reply voices
- [x] Billing
- [x] Onboarding
- [x] The reply draft dialog
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` pass

## Notes

- `docs/design.md` — the mobile rule, the tokens, the shared patterns.
- `docs/spacing.md` — new spacing uses the scale, not a raw px value.
- `apps/web/src/styles/tokens.css` — page gutters and navigation sizes already
  change at 820px and 440px.
- Presentation-only changes do not need tests that assert CSS values
  (`docs/design.md`).

## Log

- 2026-09-11T18:08+08:00 — Wrote the ticket. Starting the screen-by-screen pass.
- 2026-09-11T18:55+08:00 — Every screen rendered at 390px and 320px in Chrome,
  driven over the debugging protocol. Eight defects, and the two that mattered
  were not in any stylesheet's media query:

  **Four screens had no way in.** Below 820px `.sidebar-bottom` is hidden, and
  it held Providers, Voices, Models, Billing and Sign out. A phone could reach
  them only by typing the address. The bottom bar now has an Account item that
  opens a sheet with the same links.

  **Two tables were dragged sideways.** Monitors is 860px of five columns and
  Providers is 1060px of seven. Both sat in a horizontal scroller, so the
  columns a person opens the page for — the status, what the last poll did,
  what a provider actually returned — were off screen with nothing saying so.
  Each row is a labelled card below 600px now.

  The rest: the monitors page scrolled sideways because a `visually-hidden`
  span in the table header escaped its unpositioned scroller and landed 783px
  out; the inbox toolbar squeezed four controls onto one row, so "Saved" read
  as "S" and neither select showed a name; the notification panel asked for a
  340px minimum column on a 320px screen; a page header squeezed its sentence
  into a three-line column beside a button whose own label then wrapped; a
  source card's fourth column had no room for the connection state; and a
  connection's state chip ran under its button below 380px.

  Presentation only. One test was added — the account sheet holds the account
  links — and two were narrowed to the sidebar's copy of those links, because
  there are honestly two copies now.

- 2026-09-11T18:56+08:00 — Renumbered from US-105, which `done/2026-09/`
  already holds. `ls backlog/*/*.md` does not reach into `done/<month>/`; the
  command in `backlog/README.md` does.
