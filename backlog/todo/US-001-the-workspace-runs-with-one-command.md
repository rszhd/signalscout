---
id: US-001
title: The workspace runs with one command
type: chore
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

Nothing exists yet. Every other ticket assumes a workspace, a database and a
way to start both.

PLAN.md promises `git clone` then `docker compose up`. That promise is easiest
to keep if it is true from the first commit, because a build that was never
run on a clean machine is a build that does not work on one.

STACK.md fixes the shape: pnpm workspaces, four packages, Postgres with
`pgvector`, and a single-process mode for small servers. This ticket builds
that skeleton and nothing else. No connector, no model call, no UI beyond a
page that proves the bundle is served.

The single-process flag matters here rather than later. Retrofitting it means
untangling a worker that assumed its own process.

## Acceptance

- [ ] `pnpm install && pnpm dev` starts the API, the Vite dev server and the
      worker on a clean checkout
- [ ] `docker compose up` starts Postgres, applies migrations and serves the
      built UI on one port
- [ ] `WORKER_IN_PROCESS=true` runs the worker inside the API process, and
      `false` runs it as a second container from the same image
- [ ] The Postgres image has the `pgvector` extension available
- [ ] `packages/core` builds with no import of Fastify or React, and a test
      asserts this
- [ ] The image builds in CI and is pushed to a registry; the server pulls it
      rather than compiling
- [ ] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass and run in CI
- [ ] `.env.example` lists every variable the app reads, with no real values

## Notes

- STACK.md, *The stack* and *Deployment*, for the choices this implements.
- Four packages: `apps/api`, `apps/web`, `apps/worker`, `packages/core`.
- The `core` import rule is the one architectural rule in this repo. A lint
  rule (`no-restricted-imports`) is cheaper to enforce than a review habit.
- Skip Turborepo. pnpm workspaces are enough until builds get slow.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
