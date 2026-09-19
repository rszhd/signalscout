---
id: US-250
title: The next four documents are cut to their rules
type: chore
priority: p2
created: 2026-09-20T00:58+08:00
parent:
area: docs
resolution: shipped
---

## Context

On 2026-09-20 `sources.md`, `costs.md` and `testing.md` were cut from
13,400 words to 6,600, with the measurements moved to `history.md`. The next
four on the reading list are `STACK.md` (3,800 words), `instruments.md`
(3,800), `secrets.md` (3,200) and `accounts.md` (2,800). `STACK.md` is read
before anything structural and `secrets.md` before any credential change.

## Acceptance

- [x] Each of the four is under 2,000 words and every rule in it survives.
- [x] What was measured moves to `history.md` under a heading per document.
- [x] `AGENTS.md`'s reading list still points at each page for the same
      reason.
- [x] The cloud repository's copies of `secrets.md` and `accounts.md` are
      handled the way US-252 there decides.

## Notes

- The shape from the first three: rules head, one paragraph per rule, the
  ticket id where the story is, and a link to history.md at the top.

## Log

- 2026-09-20T00:58+08:00 — Written from the context review of 2026-09-20: the owner asked
  where the AI-assisted workflow loses context and quality, and this is one
  of the findings.
- 2026-09-20T01:13+08:00 — Shipped. STACK.md 3,793 to 1,994 words; instruments.md 3,776 to 1,658; secrets.md 3,165 to 1,668; accounts.md 2,771 to 1,713. Each moved its measurements and decisions to history.md under its own heading, indexed in Contents. STACK.md also lost two claims that were never true (TanStack Query, shadcn/ui) and one that stopped being true (no CI run yet). The cloud repository's copies are its own since US-252 there and were not touched.
