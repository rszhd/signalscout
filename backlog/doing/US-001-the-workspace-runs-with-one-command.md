---
id: US-001
title: The workspace runs with one command
type: chore
priority: p1
created: 2026-09-04T22:49+08:00
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

- [x] `pnpm install && pnpm dev` starts the API, the Vite dev server and the
      worker on a clean checkout
- [x] `docker compose up` starts Postgres, applies migrations and serves the
      built UI on one port
- [x] `WORKER_IN_PROCESS=true` runs the worker inside the API process, and
      `false` runs it as a second container from the same image
- [x] The Postgres image has the `pgvector` extension available
- [x] `packages/core` builds with no import of Fastify or React, and a test
      asserts this
- [ ] The image builds in CI and is pushed to a registry; the server pulls it
      rather than compiling
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass and run in CI
- [x] `.env.example` lists every variable the app reads, with no real values

The open box is why this ticket is still in `doing/`. The workflow is written
and the image it builds is the image that was tested, but there is no remote
yet, so no push has run it. Tick the box and move the ticket after the first
passing run on `main`.

## Notes

- STACK.md, *The stack* and *Deployment*, for the choices this implements.
- Four packages: `apps/api`, `apps/web`, `apps/worker`, `packages/core`.
- The `core` import rule is the one architectural rule in this repo. A lint
  rule (`no-restricted-imports`) is cheaper to enforce than a review habit.
- Skip Turborepo. pnpm workspaces are enough until builds get slow.

**The image name is a placeholder.** `.env.example` and `docker-compose.yml`
default to `ghcr.io/signalscout/signalscout:latest`, and CI pushes to
`ghcr.io/${{ github.repository }}`. These agree only by luck. Set the real one
when the GitHub repository exists.

**Migrations run in their own container.** `migrate` runs to completion and
`app` waits for it, so two processes never apply the same migration at boot.

**`packages/core` is resolved twice.** The image loads `dist` through the
`default` export condition. `pnpm dev` passes `--conditions=development` and
loads `src`, so nothing has to be built first and a change inside core restarts
the API and the worker. Vitest reaches the same source through an alias.

**`tsBuildInfoFile` lives inside `dist`.** Left beside `tsconfig.json`, it
survives `rm -rf dist`, and the next build reports success while emitting
nothing. That cost an hour here.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md and STACK.md.
- 2026-09-04T23:30+08:00 — Code complete. Verified by running each claim, not by reading
  the code:
  `docker compose up` in both worker modes against the built image, `pnpm dev`
  on a checkout with no `node_modules` and no `.env`, and `psql` for the
  `vector` extension in the running database.

  Every new assertion was watched failing first, as docs/testing.md requires. A
  Fastify import in core turns the boundary test and Biome red. Removing
  `CREATE EXTENSION` turns the migration test red. Inverting the
  `WORKER_IN_PROCESS` branch turns both wiring cases red. Dropping the pg-boss
  handler leaves the heartbeat job unclaimed and the test fails on it.

  One assertion did not survive that check. The first version of the API test
  ran with `WEB_DIST_PATH` pointing at nothing, so the static plugin never
  registered and the single-page fallback never installed. Deleting the `/api/`
  guard changed no result — the test passed either way, on a code path
  production never takes. It now builds a real directory with an `index.html`
  and an asset, and each break turns it red.

  Not proven here: the React tree renders. The bundle is served and the API
  answers, and nothing yet asserts what the browser draws. US-011 builds the
  inbox and needs that harness; adding it now was outside this ticket.

  Held in `doing/` on purpose. Every other box is verified, but the repository
  has no remote, so the CI box is unverifiable rather than unverified. A ticket
  closed on a workflow nobody has run is a ticket that reports work it did not
  check.
