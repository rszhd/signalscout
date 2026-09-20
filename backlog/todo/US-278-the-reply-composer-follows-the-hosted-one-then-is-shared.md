---
id: US-278
title: The reply composer follows the hosted one, then is shared
type: chore
priority: p3
created: 2026-09-20T18:16+08:00
parent: US-270
area: web
resolution:
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

- [ ] This application's composer matches the hosted layout: one composing
      block, no decorative mark, no safety badge.
- [ ] `ReplyDraft` is then exported from `@signalscout/ui` with its stylesheet;
      both applications render it from there and both copies are deleted.
- [ ] The test moves to the package and passes there.
- [ ] The saved-voice picker still reads this application's own voices; if it
      needs anything the hosted one does not, it is a prop.
- [ ] `pnpm lint:css` passes with no raw colour in the moved stylesheet.
      US-272 has already adopted the palette here; check which copy is newer.
- [ ] The composer was rendered in a browser afterwards, with a finished draft
      and with a failure.

## Notes

- `apps/web/src/ReplyDraft.tsx`, `styles/reply-draft.css`,
  `ReplyDraft.test.tsx` — and the same three hosted.
- Depends on US-274 for the harness, and reads better after US-277.

## Log

- 2026-09-20T18:16+08:00 — Written after the survey: 98 lines apart, tests
  identical, and the hosted copy is the newer layout.
