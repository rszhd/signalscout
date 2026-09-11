---
id: US-105
title: Every screen works on a phone
type: chore
priority: p2
created: 2026-09-11T18:08+08:00
parent:
area: web
resolution:
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

- [ ] Login
- [ ] Projects
- [ ] Project form (new and edit)
- [ ] Inbox
- [ ] Monitors
- [ ] New monitor (all five steps)
- [ ] Monitor detail
- [ ] Notifications
- [ ] Connections
- [ ] Providers
- [ ] Models
- [ ] Reply voices
- [ ] Billing
- [ ] Onboarding
- [ ] The reply draft dialog
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` pass

## Notes

- `docs/design.md` — the mobile rule, the tokens, the shared patterns.
- `docs/spacing.md` — new spacing uses the scale, not a raw px value.
- `apps/web/src/styles/tokens.css` — page gutters and navigation sizes already
  change at 820px and 440px.
- Presentation-only changes do not need tests that assert CSS values
  (`docs/design.md`).

## Log

- 2026-09-11T18:08+08:00 — Wrote the ticket. Starting the screen-by-screen pass.
