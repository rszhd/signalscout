---
id: US-272
title: Two pages still carry the old palette
type: chore
priority: p3
created: 2026-09-20T12:10+08:00
parent: US-270
area: web
resolution:
---

## Context

US-270 made a raw colour a lint error, so that two applications can wear one
brand: a control names `var(--accent)` and never the hex behind it. Two page
stylesheets could not pass it and are exempt in `stylelint.config.mjs` —
`reply-draft.css` and `reply-voices.css`. They carry a whole palette the brand
does not have: greens (`#52634e`, `#64765f`, `#d9e1d6`), ambers (`#ead8b7`,
`#77542f`, `#fff8e9`), blues of their own (`#dbe4f2`) and four shadows written
as `rgb()`.

That is about a dozen values on two pages. Naming each one a brand token
would be worse than the debt — the brand would gain a green it does not use
anywhere else — so the work is to adopt the palette these pages predate, which
is a visual change to the reply composer and the voice editor rather than a
rename.

The exemption list in `stylelint.config.mjs` is what this ticket deletes.

## Acceptance

- [ ] `reply-draft.css` and `reply-voices.css` name only tokens.
- [ ] The `overrides` entry for the two files is gone from
      `stylelint.config.mjs`, and `pnpm lint:css` passes without it.
- [ ] No value moved into `packages/ui`'s tokens that only one page uses.
- [ ] Both screens were rendered in a browser and the Log says what changed.

## Notes

- `apps/web/src/styles/reply-draft.css`, `styles/reply-voices.css`.
- `packages/ui/src/styles/tokens.css` — the palette to adopt.
- The hosted application has the same two files and the same debt; US-271
  there pins the package, and this ticket is a candidate to do in both.

## Log

- 2026-09-20T12:10+08:00 — Split out of US-270, which made the rule and found
  these two files could not meet it.
