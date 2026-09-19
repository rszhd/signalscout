---
id: US-246
title: history.md has headings an agent can jump to
type: chore
priority: p2
created: 2026-09-20T00:58+08:00
parent:
area: docs
resolution: shipped
---

## Context

`docs/history.md` is 25,800 words in one flat file. Until 2026-09-20 it had
no heading at all; the three sections moved in that day are the first. An
agent that greps for why a number is what it is lands in the middle of a
paragraph with no way to see what section it is in or what is near it. The
file is read on demand, so its size costs nothing at the start of a session;
its shape costs every lookup.

## Acceptance

- [x] The file has one heading per area — pipeline, sources, costs, model,
      accounts, testing, deployment — and every paragraph sits under one.
- [x] A short index at the top lists the headings.
- [x] No paragraph is rewritten or removed; the change is order and headings.
- [x] `AGENTS.md` still points at it the same way.

## Notes

- The paragraphs are in the order they were written. Grouping by area breaks
  that order, which is fine: each paragraph names its ticket and its date.

## Log

- 2026-09-20T00:58+08:00 — Written from the context review of 2026-09-20: the owner asked
  where the AI-assisted workflow loses context and quality, and this is one
  of the findings.
- 2026-09-20T01:07+08:00 — Shipped. Ten areas plus the three sections moved in earlier that day, a Contents list at the top, and the intro says the order is by area now. A sorted diff of non-heading lines against the previous version shows only the intro changed.
