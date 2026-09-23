---
id: BUG-356
title: The Field component's rules live in the applications
type: bug
priority: p2
created: 2026-09-23T14:02+08:00
parent: US-270
area: web
resolution: shipped
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

- [x] The rules `Field` needs are in the package's `theme.css`, on tokens and
      on the spacing scale; `pnpm lint:css` passes.
- [x] This application's `index.css` no longer holds them.
- [x] The `Field` stories and the `ReplyVoices` stories show the label, the
      hint and the control on three lines; the Log says what was seen.
- [ ] Every screen here that renders a `Field` was checked in a browser.
      **All but onboarding**, which shows only to a new account; its
      stylesheet loads after the package, before and after this change.
- [x] US-271 in the hosted repository says its copy of the rules is deleted
      with the rest.

## Notes

- `apps/web/src/index.css` (`.field > span`, `.field > small`,
  `.field input`, `.field textarea` and their focus rules),
  `packages/ui/src/styles/theme.css`.
- Seen in the US-351 preview: `Primitives/Field` and `Screens/ReplyVoices`.

## Log

- 2026-09-23T14:02+08:00 — Found by the component preview on its first run
  (US-351). The hosted application's `index.css` holds the same block.
- 2026-09-23T14:18+08:00 — Shipped. The rules are in `theme.css`, and five
  raw values became tokens or steps: the label `#343a35` is
  `--muted-strong`, the hint's 3px/7px margin is `--space-1`/`--space-2`, the
  input's 10px/11px padding is `--space-2`/`--space-3`, the focus border
  `#848d85` is `--muted`, and the focus shadow is a new `--focus-ring` with
  the same value. **One rule changed order, not only place**: the package
  loads after `index.css`, so a rule there with the same specificity that
  used to win now loses. The budget's `$` input is the one such rule inside
  a `Field`, and it is now `.field .amount-input input`. Checked by reading
  every `Field`'s computed style on the running `dev` app and on this branch,
  side by side: projects/new, reply-voices, models, connections, the monitor
  page, the monitor form's first step, and the login page (on 127.0.0.1,
  where the browser holds no session). The only differences are the label
  colour and the hint margin; every input keeps its page padding. The budget
  input was checked by putting its markup into the page on both, because
  reaching step five asks a model for a plan. The Field and ReplyVoices
  stories show three lines. 2,344 tests pass.
