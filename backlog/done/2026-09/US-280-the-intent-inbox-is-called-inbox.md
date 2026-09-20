---
id: US-280
title: The intent inbox is called Inbox
type: chore
priority: p3
created: 2026-09-20T19:20+08:00
parent:
area: web
resolution: shipped
---

## Context

"Intent inbox" is more terminology than the navigation needs. "Inbox" is
familiar, fits every width, and is what the screen already calls itself in
its own view switch. The hosted application made the same change as US-181
there, and the owner asked for it here.

It also removes a mechanism. US-123 gave the navigation item two labels —
`nav-label-wide` and `nav-label-narrow` — because "Intent inbox" did not fit
one of four places in a bottom bar at 320px, so a phone showed "Inbox" and a
desktop the long name. One label that fits everywhere needs no second span
and no rule to swap them.

The product's concept keeps its name. PLAN.md says the product is an intent
inbox, and STACK.md and the package README describe it that way; that is
what the thing is, not what a button says.

## Acceptance

- [x] The navigation item and the page heading say "Inbox".
- [x] The `nav-label-wide` / `nav-label-narrow` spans and their rules are gone;
      the account-sheet button, which shared one of those rules, still shows
      only on a phone.
- [x] Routes and inbox behaviour are unchanged.
- [x] The tests that named the old label name the new one, and the design
      document's bottom-bar list says "Inbox".

## Notes

- `apps/web/src/App.tsx:548`, `Inbox.tsx:760`, `index.css:243–252` and
  `:1758–1765`, `docs/design.md:32`.
- Hosted: US-181.

## Log

- 2026-09-20T19:20+08:00 — Asked for by the owner.
- 2026-09-20T19:30+08:00 — Shipped. The item and the heading say "Inbox"; the
  two spans and the two rules that swapped them are gone, and the account
  button keeps the phone-only rule it shared with one of them. The three
  App tests that had asserted "Intent inbox" in the page's text could not
  simply say "Inbox" — that word is in the sidebar on every project screen
  and would prove nothing — so they assert the page heading. The login test
  that asserted no "Inbox" text now asserts no navigation and no heading,
  which is what it meant. 350 web tests pass. PLAN.md, STACK.md and the
  package README keep "intent inbox" for the concept.
