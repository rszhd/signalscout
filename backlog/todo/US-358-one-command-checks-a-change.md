---
id: US-358
issue: 101
title: One command checks a change
type: chore
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: tooling
resolution:
---

## Context

A change is checked by four commands: `pnpm lint`, `pnpm lint:css`,
`pnpm typecheck` and `pnpm test`. An agent picks which to run, and a skipped
one is found by CI. The full suite takes about 72 seconds on CI, so an agent
often runs it at the end only, or not at all.

Vitest can run only the tests that a change reaches (`vitest --changed`).
That gives a fast check inside a task, and the full suite stays for the end.

## Acceptance

- [ ] `pnpm check` runs lint, lint:css, typecheck and the tests that the
      uncommitted change reaches, and exits non-zero if any fails
- [ ] It says which step failed, in its last line
- [ ] The Commands block in AGENTS.md lists it, and says that `pnpm test`
      is still the check before a commit

## Notes

Check that `--changed` follows the aliases in `vitest.config.ts`, so a change
in `packages/engine/src` reaches the tests that import `@signalscout/engine`.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
