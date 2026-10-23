---
id: US-459
title: The docs site shows SignalScout Cloud only
type: chore
priority: p1
created: 2026-10-23T12:33+08:00
parent:
area: docs
resolution: shipped
---

## Context

The owner asked for self-hosting to leave docs.signalscout.run, as it left
the landing site the same day. Of three ways (move the guide to GitHub, hide
it, delete it), the owner chose to hide it.

Hidden means nothing on the site leads to `site/self-hosting/`: not the menu,
the home page, another page, search or `llms.txt`. The pages stay at their
addresses, because `README.md`, `SECURITY.md` and three files in `docs/` link
into them, and the repository has no other install guide. A reader who
arrives from GitHub still gets the guide's own sidebar.

## Acceptance

- [x] The menu, the home page and the pages outside `self-hosting/` have no
      link to the guide, to GitHub, or text about running it yourself.
- [x] Search and `llms.txt` leave the guide out.
- [x] The guide's pages build and keep their own sidebar.
- [x] The webhook contract moves to `using/webhooks`, because Cloud users
      need it; `self-hosting/webhooks` keeps only what differs on a server
      you run.
- [x] `site/README.md` says the guide is hidden, so the next page added
      does not link into it.
- [x] Deployed to docs.signalscout.run, and the live menu shows Getting
      started and Cloud only.

## Notes

- The edit link ("Suggest a change to this page") and the fair-source footer
  went too: both lead to the repository.
- A search engine can still find the guide's pages. A `noindex` would hide
  them from GitHub readers who search too, so it is not added.

## Log

- 2026-10-23 12:33 — Built. `npm run build` passes, so no internal link is
  dead. In the built site, no page outside `self-hosting/` shows a link or
  text about it; the only matches are VitePress's page map and sidebar data
  inside each page's script. `llms.txt`, `llms-full.txt` and the search index
  hold no self-hosting page. Screenshots of the home, Cloud, Webhooks and
  Install pages look right, and the diagrams render once the page has had
  time to draw them.
- 2026-10-23 12:45 — Deployed by the owner from the `dev` checkout
  (dpl_TPrqoy78FJZ1Vd8yEdWjGhEE1fpC, Ready). The first try said "Not
  authorized"; the second, with `--debug`, went through. Live: the menu shows
  Getting started and Cloud, `/using/webhooks` answers 200, `/self-hosting/`
  and `/self-hosting/install` still answer 200, and `llms.txt` lists no
  self-hosting page.
