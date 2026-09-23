---
id: US-381
title: The README opens with a banner
type: chore
priority: p2
created: 2026-09-23T18:25+08:00
parent:
area: docs
resolution: shipped
---

## Context

The owner wants the repository page to open the way Typebot's does: a wide
banner with the mark and one headline on the left, and the product on the
right. The README's only picture was `docs/img/inbox.jpg`, a screenshot of a
real inbox that shows a real Reddit user's handle and post (US-343).

The banner is drawn in the product's own look, at the owner's request. It is
a story in the UI package, built from `MatchCard`, `MatchDetail`, the mark
and the tokens, with invented matches, so a change to those changes the next
picture and no real person appears in it.

## Acceptance

- [x] `Brand/README banner` renders the mark, the landing's headline, the
      README's tagline and the inbox, from the package's components and
      tokens, with invented matches only.
- [x] `node scripts/readme-banner.mjs` saves it as `docs/img/banner.png`
      with the Chrome already on the machine; no browser library is added.
- [x] The README opens with the banner, a centred tagline, and links to the
      cloud, the docs and the install.
- [x] `docs/img/inbox.jpg` is gone, and nothing links to it.

## Notes

The picture is 2560 × 800, twice the story's canvas, and about 470 KB.

## Log

- 2026-09-23T18:25+08:00 — Built and saved. Biome and the stories'
  typecheck pass. The README was not seen rendered on GitHub; the HTML is
  the same shape as Typebot's, which GitHub renders.
