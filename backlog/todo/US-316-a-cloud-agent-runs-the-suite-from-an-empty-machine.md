---
id: US-316
title: A cloud agent runs the suite from an empty machine
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: tooling
resolution:
---

## Context

Many contributors now work through an agent on a cloud machine: Copilot's
coding agent, Codex in the cloud, Claude Code on the web. Each starts from an
empty machine. `pnpm test` needs Postgres with pgvector and refuses a fake,
and the repository has no `.devcontainer` and no Copilot setup steps. So the
agent cannot run the suite, and it opens a pull request that nothing checked
before CI.

A devcontainer that starts `pgvector/pgvector:pg17` beside Node 24 answers
the person in Codespaces and the agent at once.

## Acceptance

- [ ] `.devcontainer/` starts Node 24, pnpm and `pgvector/pgvector:pg17`,
      and `pnpm install && pnpm test` passes inside it with no other step.
- [ ] `.github/workflows/copilot-setup-steps.yml` prepares the same
      environment for Copilot's coding agent.
- [ ] AGENTS.md says in one line how a cloud agent gets a database.
- [ ] No paid key is set in either environment, and `vitest.config.ts`
      still blanks `AI_API_KEY`.
- [ ] The Log says which of the three agents was run end to end and which was
      not.

## Notes

- CI's `services.postgres` block in `.github/workflows/ci.yml` is the
  shape to copy, including the `intentwatch` credentials the tests expect.
- US-313 names the same commands for a person.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
