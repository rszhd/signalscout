---
id: US-277
title: The reply voice editor is one screen
type: chore
priority: p3
created: 2026-09-20T18:14+08:00
parent: US-270
area: web
resolution: shipped
---

## Context

`ReplyVoices.tsx` is 516 lines here and 512 in the hosted application, and
**every real difference is the primitives**: the hosted copy uses `Button` and
`Field` and this one still writes `<button className="primary-button">` and
`<label className="field">` by hand (US-099 is that work). Its test file is
**byte-identical** in both — 234 lines, diff of zero.

It is the same feature, in two copies. Nothing about who pays for a model
touches it: a voice is a name and an instruction, stored per account, offered in
the draft menu. There is no plan, no key, no schedule in it.

**This one crosses a line US-270 drew**, and that is the decision to make
rather than to hide. That ticket said the brand is one and the screens are two,
because screens carry the product: one monitor per project hosted, five steps
and a budget here. This screen carries none of it. So the line holds where it
was drawn for a reason and moves where the reason is absent — a screen that is
the same screen is one screen, and the rule gains a sentence saying so.

What moves with it: the screen, its stylesheet, and its test. What stays: the
route that renders it, because an address is each application's.

**Do US-099 first or take the hosted copy.** Taking the hosted copy is the
cheaper path and it finishes US-099 for this screen at the same time, which is
how US-273 went.

## Acceptance

- [x] `ReplyVoices` is exported from `@signalscout/ui` with its stylesheet,
      taken from the hosted copy, and uses `Button` and `Field`.
- [x] Both applications render it from the package; this one's copy, its
      stylesheet and its test are deleted. **This application does; the hosted
      one adopts it in US-271**, which names it.
- [x] The test moves to the package and passes there, on US-274's harness.
- [x] Anything the two copies disagreed about is named in the Log, with which
      answer was kept.
- [x] AGENTS.md's brand paragraph gains the sentence: a screen that is the same
      screen in both products may be shared, and a screen that carries the
      product may not.
- [x] `pnpm lint:css` passes and no raw colour travels: the hosted copy's
      stylesheet has some.
- [ ] The screen was rendered in a browser in this application afterwards.
      **Not done**: the Chrome extension is not connected. The dev server
      answers the route and the package's stylesheet resolves.

## Notes

- `apps/web/src/ReplyVoices.tsx`, `styles/reply-voices.css`,
  `ReplyVoices.test.tsx` — and the same three in `signalscout-cloud`.
- US-272 adopted the brand palette in this application's copy of the
  stylesheet; the hosted one may not have, so check which is newer before
  taking it.
- Depends on US-274 for the harness.

## Log

- 2026-09-20T18:14+08:00 — Written after the survey. The two copies differ by
  44 lines and all of them are `Button` and `Field`; the tests are identical.
- 2026-09-20T19:55+08:00 — Shipped, the browser pass owed. The screen is the
  hosted copy, with two changes on the way in: its two hand-written state
  blocks are `PageState` and its two error lines are `FormError` (US-276),
  which the hosted copy predates. The stylesheet: the two copies were one
  layout, and the only difference was this application's already naming
  `--danger` where the hosted one wrote two reds — so the newer stylesheet was
  this one, byte for byte the hosted's tokenised, and it is the package's now.
  The test moved unchanged but for its imports, on US-274's harness. `App.tsx`
  renders the screen from the package on its own route. AGENTS.md's brand
  paragraph gained the sentence. 2,269 tests pass and the tarball installs
  and works outside the workspace.
