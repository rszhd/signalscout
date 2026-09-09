---
id: US-099
title: A button, a field and a dialog are one component each
type: chore
priority: p2
created: 2026-09-10T01:20+08:00
parent:
area:
resolution:
---

## Context

**The shared theme works, but only by convention.** `styles/tokens.css` and
`styles/theme.css` hold the palette and the primitives, and `docs/design.md`
says a page owns layout and nothing else. A person following the rule writes a
consistent screen. The rule is not enforced, so it drifts.

Three duplications sit in `apps/web/src`:

**A dialog is built three ways.** `Models.tsx` and `Connections.tsx` each open
a native `<dialog>` with their own dialog class, a heading row and a Close
button that calls `dialog.current?.close()`. `ReplyDraft.tsx` is different in
kind: it renders `aria-modal="true"` plus `role="dialog"` on a div, behind a
backdrop div, and closes on a manual `keydown` listener
(`apps/web/src/ReplyDraft.tsx:246`). Two of three are the native pattern; one
is a hand-rolled modal, with its own focus and Escape handling. Three dialog
implementations mean three chances for the a11y to disagree, and they already
do.

**A button is a repeated class string.** `secondary-button` appears 34 times
across 11 files; `primary-button`, `top-primary-button` and `compact-button`
the same way. Nothing ties the class name to the intent, so a page can write
`className="secondary-button"` on an element that is neither secondary nor a
button.

**A field is a repeated label-plus-control shape.** `.field` with a `<span>`
label and a `.form-control` input or select repeats about thirty times, all
hand-rolled, with the same `aria-label`-and-`<label>` pairing each time.

**The fix is a component layer, not more CSS.** Keep the theme and the page
styles as they are. Add typed components that own the class names and the
semantics, so a page names what it wants and the component guarantees how it
renders. `packages/core` stays untouched — it imports neither React nor the
theme, and this change is entirely in `apps/web`.

**This is the pattern-setter, not the full sweep.** Migrate the two dialog
screens as the examples. A docs page names the rule so the next screen follows
it. Everything else migrates in later tickets, one screen at a time, because a
full sweep is a large diff with high test risk for a small consistency gain
per commit.

## Acceptance

- [ ] `apps/web/src/components/` exists, holding `Button`, `Dialog` and `Field`
- [ ] `Button` owns the shared button class for its intent — primary,
      secondary, compact — and keeps the existing class names, so the theme
      needs no change
- [ ] `Dialog` wraps the native `<dialog>`, owns the heading row and the Close
      button, forwards the ref for `showModal`, and sets `aria-labelledby`
      from the title id
- [ ] `Field` owns the `.field` label-plus-control shape
- [ ] `Connections.tsx` and `Models.tsx` use `Button` and `Dialog` for their
      dialogs. The rendered class names and `aria-labelledby` ids are
      unchanged, so the existing tests pass without a change to their
      assertions
- [ ] `docs/design.md` names the rule: a screen uses a component before writing
      a raw theme class, and the components are the only path to a dialog
- [ ] Spacing: `theme.css` and `reply-draft.css` use the `--space-*` scale; a
      `padding`, `margin` or `gap` is `0`, `auto`, a token or a `calc()` of
      tokens. `docs/spacing.md` names the rule and the snapshot decision
- [ ] `pnpm lint`, `pnpm lint:css`, `pnpm typecheck` and the web tests all pass
- [ ] `backlog/index.sh` regenerates the lists

## Notes

- `ReplyDraft.tsx`'s hand-rolled modal is the largest inconsistency. It is left
  for the follow-up ticket that migrates the inbox; this ticket sets the
  pattern it should move to. Changing it here would widen the diff and touch
  the inbox tests.
- The dialog tests stub `HTMLDialogElement.prototype.showModal` and `close`
  and read `.open`. The component must keep the native dialog, the ref and the
  `aria-labelledby`, or those tests break.
- The renamed `title` prop on `Dialog` is `titleId` — it is an id for
  `aria-labelledby`, not visible text.
- Spacing: `index.css` and the un-migrated page stylesheets are grandfathered,
  so `pnpm lint:css` names the two migrated files explicitly. Each migrated
  page is added to the command and to `docs/design.md`'s migration list.
  Biome has no CSS spacing rule; the check is stylelint.

## Log

- 2026-09-10T01:20+08:00 — Written. Three dialog implementations and a 34-fold
  repeated button class are what this addresses. `packages/core` is out of
  scope; the design doc rule is the deliverable with the two migrated screens.
- 2026-09-10T01:38+08:00 — Spacing sweep added, on the owner's request for
  across-the-site consistency. The off-scale values were concentrated in
  `theme.css` and `reply-draft.css`; both are now on the scale, and
  `docs/spacing.md` names the rule. `pnpm lint:css` is the enforcement, since
  Biome ships no CSS rule for it. Values were snapped to the nearest step;
  `index.css` (160 off-scale rules) is left for its per-page migration.
