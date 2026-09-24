---
id: US-357
issue: 100
title: An edit is formatted as it is written
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: tooling
resolution:
---

## Context

The repository has no `.claude/settings.json`. An agent learns about a
formatting or lint error only when it runs `pnpm lint` by choice, or when CI
fails. The fix is then a second round of edits, paid for in context.

Biome takes about two seconds over the whole repository on CI, so running it
on one file after each edit costs almost nothing.

Permission prompts for read-only commands also stop a session that runs
alone. The `/fewer-permission-prompts` skill can write an allowlist from the
transcripts.

## Acceptance

- [ ] `.claude/settings.json` is committed, with a `PostToolUse` hook on
      `Edit|Write` that runs `biome check --write` on the edited file only
- [ ] The hook skips files Biome does not handle and never fails the edit
- [ ] The file allows the read-only commands the transcripts show, and no
      command that writes, spends money or reaches a remote
- [ ] `docs/map.md` or AGENTS.md says in one sentence that the hook exists

## Notes

The cloud repository has the same gap. Its ticket is US-367.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
