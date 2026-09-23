---
id: US-346
title: The contributor docs say only what a contributor needs
type: chore
priority: p2
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution: shipped
---

## Context

The repository's documents come to 37,000 words. Once the user-facing half
is on the site (US-343, US-344), what remains is for people and agents who
change the code, and it can be shorter: every page is read before an edit,
and a word nobody needs is paid for in every session.

The paths stay. 133 files name them, `docs/testing.md` alone 449 times.

## Acceptance

- [x] Each contributor page keeps its rules and loses the parts now on the
      site, the repetition between pages, and any story that belongs in a
      ticket's Log.
- [x] `docs/map.md` and the README's repository table say which pages are
      for contributors and link to the site for everything else.
- [x] No path a file in code, config or `.claude/` names is moved or
      removed.
- [x] The word count before and after is in the Log.

## Notes

`node scripts/context-cost.mjs` says what a session reads before it writes;
run it before and after.

Five pages now repeat the site: `docs/self-hosting.md`, `notifications.md`,
`accounts.md`, `secrets.md` and `costs.md`. Before cutting their user half,
move the references that send a *user* there to the site: the comments in
`docker-compose*.yml`, `.env.example` and `.env.example.self-hosted`,
`SECURITY.md`, and `live-webhook.ts`, whose receiver is written from the
webhook contract, which now lives in `site/self-hosting/webhooks.md`.

## Log

- 2026-09-23T10:50+08:00 — Written as part of the site split, US-342.
- 2026-09-23T12:07+08:00 — `docs/` went from 23,257 words to 19,886. The four pages that held a
  self-hoster's half were rewritten for a contributor: `self-hosting.md`
  2,440 → 701, `notifications.md` 1,976 → 950, `accounts.md` 1,808 →
  1,206, `secrets.md` 1,801 → 1,728. Every section a file names was kept
  (*Testing before storing*, *Rotating the key*, *Whose key is it*,
  *Locked out*). The references that sent a user to them — the compose
  files, both example env files, `SECURITY.md`, `PLAN.md`, `releasing.md`,
  and the notification code's comments — now point at the site.
  Not cut: `costs.md`, `sources.md`, `pipeline.md`, `testing.md`,
  `instruments.md`, `releasing.md`, `design.md` and `deletions.md` hold no
  user half, were checked line by line in BUG-339 the same morning, and are
  rules a contributor reads before an edit. `context-cost.mjs` measures past
  sessions from their transcripts, so it has nothing to say about this
  change until sessions read the new pages.
  Found while moving the references: three comments in `.env.example` that
  the site's configuration reference shows were wrong — the key naming rule
  from before US-024, `ENCRYPTION_KEY` saying nothing writes an encrypted
  row, and Bright Data opening as how Reddit arrives. All three are fixed.
