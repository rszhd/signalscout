---
id: BUG-356
title: The Field component's rules live in the applications
type: bug
priority: p2
created: 2026-09-23T14:02+08:00
parent: US-270
area: web
resolution:
---

## Context

`Field` is exported from `@signalscout/ui`, and its layout is not. The rules
that put the label, the hint and the control on three lines — `.field > span`
and `.field > small` as `display: block`, and the input and textarea borders,
padding and focus ring — are in each application's `index.css`, the same in
both. The package's own stylesheets only add to them: `reply-voices.css` and
`reply-draft.css` style `.field > span` inside their screens and assume the
block layout is already there.

So `Field` and the two shared screens that use it look right only inside an
application that brings those rules. The component preview (US-351) is the
first place that renders them without one, and there the label and its hint
run together on one line: "Voice nameA short name you will recognize".

A consumer that took the README at its word — import `styles.css` and use the
component — gets the broken layout. The hosted application would not see it
when it adopts the package (US-271 there), because its own `index.css` has the
same rules; it would see it the day it deletes them as copies.

The rules also hold raw values the package forbids: `#343a35`, `#848d85`, a
raw shadow colour, and spacing of 3px, 7px, 10px and 11px.

## Acceptance

- [ ] The rules `Field` needs are in the package's `theme.css`, on tokens and
      on the spacing scale; `pnpm lint:css` passes.
- [ ] This application's `index.css` no longer holds them.
- [ ] The `Field` stories and the `ReplyVoices` stories show the label, the
      hint and the control on three lines; the Log says what was seen.
- [ ] Every screen here that renders a `Field` was checked in a browser.
- [ ] US-271 in the hosted repository says its copy of the rules is deleted
      with the rest.

## Notes

- `apps/web/src/index.css` (`.field > span`, `.field > small`,
  `.field input`, `.field textarea` and their focus rules),
  `packages/ui/src/styles/theme.css`.
- Seen in the US-351 preview: `Primitives/Field` and `Screens/ReplyVoices`.

## Log

- 2026-09-23T14:02+08:00 — Found by the component preview on its first run
  (US-351). The hosted application's `index.css` holds the same block.
