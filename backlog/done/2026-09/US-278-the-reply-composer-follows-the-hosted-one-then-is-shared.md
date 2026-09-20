---
id: US-278
title: The reply composer follows the hosted one, then is shared
type: chore
priority: p3
created: 2026-09-20T18:16+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

`ReplyDraft.tsx` is 378 lines here and 362 hosted, 98 apart, and the hosted one
is ahead: it simplified the composer (`37668c1` there, "Simplify the inbox reply
composer"). This copy still has the older header — the ✦ mark, the
"Turn this conversation into a thoughtful starting point." line and the
"You review and post" badge — and a separate controls row the hosted one folded
into one composing block.

Its test file is **byte-identical** in both, which says the behaviour is the
same and the layout is not.

So this is US-273's shape again: follow the treatment, then share the component,
in that order and in one ticket. Sharing it first would freeze the older layout
into the package and make the hosted application take a step backwards to adopt
it.

Nothing in the composer is product. A draft is a model call on whoever's key
the deployment uses, and the screen says the same thing either way: nothing is
posted from here.

## Acceptance

- [x] This application's composer matches the hosted layout: one composing
      block, no decorative mark, no safety badge.
- [x] `ReplyDraft` is then exported from `@signalscout/ui` with its stylesheet;
      both applications render it from there and both copies are deleted.
      **This application does; the hosted one adopts it in US-271.** Following
      and sharing collapsed into one step: taking the hosted copy as the
      package's is what made this application follow it.
- [x] The test moves to the package and passes there.
- [x] The saved-voice picker still reads this application's own voices; if it
      needs anything the hosted one does not, it is a prop. It needed nothing:
      both read `/api/reply-prompts`, and the byte-identical test proved the
      behaviour was already one.
- [x] `pnpm lint:css` passes with no raw colour in the moved stylesheet.
      US-272 has already adopted the palette here; check which copy is newer.
- [ ] The composer was rendered in a browser afterwards, with a finished draft
      and with a failure. **Not done**: the Chrome extension is not connected.
      The dev server resolves the package's stylesheet and the inbox route
      answers.

## Notes

- `apps/web/src/ReplyDraft.tsx`, `styles/reply-draft.css`,
  `ReplyDraft.test.tsx` — and the same three hosted.
- Depends on US-274 for the harness, and reads better after US-277.

## Log

- 2026-09-20T18:16+08:00 — Written after the survey: 98 lines apart, tests
  identical, and the hosted copy is the newer layout.
- 2026-09-20T20:20+08:00 — Shipped, the browser pass owed. The hosted copy is
  the package's: its one form error is `FormError`, and its stylesheet's ten
  raw values are tokens — the same choices US-272 had made on this
  application's older layout: `--accent` and `--accent-soft` for focus,
  `--accent-tint` for the spinner's ring, `--success` for a copied draft,
  `--scrim` behind the dialog, and `--warning` with a new `--warning-soft`
  for the checks, the pair of `--danger-soft`. The test moved unchanged but
  for its imports. The inbox renders the composer from the package. 2,269
  tests pass and the tarball installs and works outside the workspace.
