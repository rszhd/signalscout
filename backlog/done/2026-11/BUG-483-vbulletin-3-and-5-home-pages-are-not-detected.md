---
id: BUG-483
title: vBulletin 3 and 5 home pages are not detected
type: bug
priority: p2
created: 2026-11-01T01:47+08:00
parent: US-473
area: pipeline
resolution: shipped
---

## Context

`detectIndex` knows vBulletin 4's `forumbit_post` rows and vBulletin 5's
`forum-title` list. A vBulletin 3 home page has neither (acousticguitarforum,
vBulletin 3.8.11), and a vBulletin 5 home page built from widgets has no
section list (pitmaster.amazingribs.com, 5.7.5). The feed survey of
2026-11-01 dropped both as a forum no parser knows; acousticguitarforum
names only a feed on another host, which US-478 does not take.

## Acceptance

- [x] A home page that names vBulletin 3 or 4 and links `forumdisplay.php?`
      is vBulletin 3/4.
- [x] A page with vBulletin 5's generator mark and `vb-page-body` is
      vBulletin 5.
- [x] Tests on both pages' marks; every forum test still passes.

## Notes

`vbulletin4.ts` and `vbulletin5.ts` in `packages/engine/src/sources/forums/`.

## Log
- 2026-11-01T01:59+08:00 — vBulletin 3/4 by its version words plus
  `forumdisplay.php?`, vBulletin 5 by `vb-page-body` plus its generator.
  Fixtures `vbulletin3-index.html` (acousticguitarforum) and
  `vbulletin5-widgets-index.html` (amazingribs); the scrubber now takes vB3's
  `member.php?find=lastposter` names, which the first capture leaked (fixed,
  captured again, read). Live recheck: acousticguitarforum 15 threads;
  amazingribs is found, and its feed is empty through both readers. 2,757
  tests pass.
