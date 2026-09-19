---
id: US-244
title: The screens no browser has rendered
type: chore
priority: p2
created: 2026-09-20T00:56+08:00
parent: US-083
area: web
resolution:
---

## Context

AGENTS.md names *screens no browser has rendered* as a standing gap. Three
closed tickets each left one such box. US-083: a real browser has rendered the
models screen and moved a default. US-135: one editor window on the main
checkout lists every worktree in its source-control view. This ticket is where
they are seen, in one sitting, with `pnpm dev` or `pnpm preview`.

## Acceptance

- [ ] The models screen was rendered in a browser and a default was moved;
      the Log says what was seen.
- [ ] An editor window on the main checkout listed a worktree's changes; the
      Log says which editor.
- [ ] Anything wrong that was seen has a BUG ticket.

## Notes

- `pnpm preview` puts the app on a public link for a phone.
- The Chrome tool in Claude Code can render the screens without a person.

## Log

- 2026-09-20T00:56+08:00 — Split out of US-083 when it was closed: the rest of that ticket
  was done and this box kept it in doing/.
