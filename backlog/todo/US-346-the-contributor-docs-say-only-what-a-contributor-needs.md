---
id: US-346
title: The contributor docs say only what a contributor needs
type: chore
priority: p2
created: 2026-09-23T10:50+08:00
parent: US-342
area: docs
resolution:
---

## Context

The repository's documents come to 37,000 words. Once the user-facing half
is on the site (US-343, US-344), what remains is for people and agents who
change the code, and it can be shorter: every page is read before an edit,
and a word nobody needs is paid for in every session.

The paths stay. 133 files name them, `docs/testing.md` alone 449 times.

## Acceptance

- [ ] Each contributor page keeps its rules and loses the parts now on the
      site, the repetition between pages, and any story that belongs in a
      ticket's Log.
- [ ] `docs/map.md` and the README's repository table say which pages are
      for contributors and link to the site for everything else.
- [ ] No path a file in code, config or `.claude/` names is moved or
      removed.
- [ ] The word count before and after is in the Log.

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
