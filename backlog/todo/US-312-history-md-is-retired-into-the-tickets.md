---
id: US-312
issue: 65
title: history.md is retired into the tickets that hold its evidence
type: chore
priority: p2
created: 2026-09-23T09:00+08:00
parent:
area: docs
resolution:
---

## Context

`docs/history.md` is 32,000 words, the largest document in this repository,
and the owner's judgement on 2026-09-23 is that nobody reads it and the
tickets already track every decision.

**That was tested before it was accepted.** Twenty-six measurements were
taken from paragraphs that name no ticket — the ones most likely to be
orphaned — and every ticket file was searched for those exact numbers.
**Twenty-five of the twenty-six are already in a ticket. None was found only
in `history.md`.** It is a second copy, not a second source. Every ticket id
it names still has a file, so nothing it points at has been lost either.

What retiring it costs is the navigation: the file is organised by subject —
Pipeline, Sources, Model, Costs, Accounts — so it answers "why is this
threshold what it is" without knowing the ticket id. A ticket Log answers
that only if you already know where to look. That cost is real and is
accepted: it is navigation, not evidence, and 32,000 words is too much to
carry for it.

**This is a rewrite, not a delete.** Seventy references point at the file
from `AGENTS.md`, `README.md`, `PLAN.md`, `STACK.md`, `CHANGELOG.md`, six
`docs/` pages, four source files and `scripts/comment-density.mjs`. Several
were added on 2026-09-22 by US-302's comment rule, which says a measurement
belongs in `history.md`. That rule changes with this ticket.

## Acceptance

- [ ] Every substantial paragraph is checked against the tickets, not
      sampled. Anything found **only** in `history.md` is moved into the Log
      of the ticket that earned it, before the file is removed. The count is
      recorded here.
- [ ] `docs/history.md` is deleted.
- [ ] All seventy references are rewritten to name the ticket that holds the
      evidence — `US-048's Log`, not `docs/history.md, *Sources*`. A
      reference with no identifiable ticket is a paragraph that failed the
      check above.
- [ ] AGENTS.md's comment rule says a measurement stays in its ticket's Log.
      The two things a comment is not are unchanged.
- [ ] `scripts/comment-density.mjs` and US-302's parked children stop naming
      the file.
- [ ] README.md's repository table drops the row.
- [ ] `pnpm lint`, `pnpm typecheck` and the suite pass. The diff is comments
      and documents; no behaviour moves.

## Notes

- The check is the expensive part and the only part that can lose something.
  Do it with a script that reports what it could not place, and read that
  list by hand rather than trusting a pass rate.
- `backlog/done/` holds 209 tickets; `history.md` names 109 of them. The 100
  it does not name are not a gap — it was always curated.

## Log

- 2026-09-23T09:00+08:00 — Written after the owner called the file redundant. The claim was tested before it was accepted: 25 of 26 orphan-looking measurements were already in a ticket and none was unique to the file. The earlier position in this session — that it is an index worth keeping — did not survive that evidence.
