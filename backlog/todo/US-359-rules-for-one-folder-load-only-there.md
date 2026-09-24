---
id: US-359
issue: 102
title: The rules for one folder load only in that folder
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: tooling
resolution:
---

## Context

Every session loads all of AGENTS.md, which is 2,847 words. On 2026-09-23
`scripts/context-cost.mjs` reported a median of 214,266 tokens in context at
a task's first edit.

Several rules apply to one folder only: migrations to `packages/pipeline`
and `apps/api/drizzle`, addresses to `apps/web`, tokens to `packages/ui`.
Claude Code loads a `CLAUDE.md` in a subfolder only when it reads a file
there. So a rule moved there is paid for only by the sessions that need it.

Codex reads a nested `AGENTS.md` only on the path to its working directory.
So the root file must keep a one-line pointer to each nested file.

## Acceptance

- [ ] Each rule that applies to one folder is moved to an `AGENTS.md` in that
      folder, with a `CLAUDE.md` beside it that imports it
- [ ] The root AGENTS.md keeps one line per moved rule that names the file
- [ ] No rule is lost: each moved paragraph is found in exactly one file
- [ ] `context-cost.mjs` is run before and after over comparable tasks, and
      the Log records both medians

## Notes

US-260 asks for the measuring script, and `scripts/context-cost.mjs` exists.
Update or close US-260 when this ticket uses it.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
