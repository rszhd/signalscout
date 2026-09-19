---
id: US-249
title: Recurring procedures are skills, and two checks are hooks
type: chore
priority: p2
created: 2026-09-20T00:58+08:00
parent:
area: tooling
resolution:
---

## Context

Five procedures recur and each is read as prose every time: capture a
fixture, run the two scoring captures, add a migration, cut a release, make
and remove a worktree. The repository has one skill (`socialcrawl`) and no
hooks. Two rules depend on an agent remembering them at commit time:
`backlog/index.sh --check` and, in the cloud repository,
`packages-from-source.mjs check`. A hook runs them whether or not anybody
remembers.

## Acceptance

- [ ] `.claude/skills/` holds one skill per procedure, each a checklist
      under 300 words that names the commands and the document holding the
      why. The document keeps the why and loses the step list.
- [ ] A pre-commit hook runs `backlog/index.sh --check` and refuses a commit
      with a stale list.
- [ ] The same in the cloud repository, plus
      `node scripts/packages-from-source.mjs check`.
- [ ] `AGENTS.md` names the skills where it now names the procedures.

## Notes

- Claude Code loads a skill on demand, so a skill costs nothing until it is
  used; a paragraph in a document costs every reader.
- `docs/instruments.md` and `docs/releasing.md` hold the step lists today.

## Log

- 2026-09-20T00:58+08:00 — Written from the context review of 2026-09-20: the owner asked
  where the AI-assisted workflow loses context and quality, and this is one
  of the findings.
