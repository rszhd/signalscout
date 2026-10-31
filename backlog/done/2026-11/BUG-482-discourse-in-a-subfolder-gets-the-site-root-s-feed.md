---
id: BUG-482
title: Discourse in a subfolder gets the site root's feed
type: bug
priority: p2
created: 2026-11-01T01:47+08:00
parent: US-473
area: pipeline
resolution: shipped
---

## Context

Discourse's feed address is `/latest.json?order=created` from the site
root, so a forum in a folder gets the main site's page instead: sitepoint.com
`/community/`, homebrewersassociation.org `/forum/` and crappie.com
`/crappie/` all listed nothing in the feed survey of 2026-11-01. Discourse
names its folder on every page, in `data-base-uri` of
`<meta id="data-discourse-setup">`.

## Acceptance

- [x] The feed is `latest.json?order=created` under the address the page's
      `data-base-url` names, folder and host, and under the forum's own
      folder of the address read when it names none.
- [x] Topic and thread addresses keep the folder.
- [x] A test shows a forum in a folder and one at the root.

## Notes

`packages/engine/src/sources/forums/discourse.ts`, `feedUrl`.

## Log
- 2026-11-01T01:59+08:00 — The feed is `<data-base-url>/latest.json`: the
  page's own address, folder and host, since www.homebrewersassociation.org
  `/forum/` redirects to forum.homebrewersassociation.org. Topic and thread
  addresses keep the folder too (they were `origin/t/…`). A browser shows the
  JSON in its text view, whose head held a second `<meta charset>` that
  `unwrapped` refused, RSS included; widened. Fixture
  `discourse-folder-index.html` (head only, sitepoint). Live recheck (7
  units): sitepoint 30 topics through the browser, homebrewersassociation 30;
  crappie.com `/crappie/latest.json` answers Discourse's not_found JSON,
  likely a forum behind a login. 2,757 tests pass.
