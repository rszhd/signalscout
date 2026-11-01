---
id: BUG-492
title: A release carries high and critical dependency holes
type: bug
priority: p1
created: 2026-11-01T23:42+08:00
area: dependencies
resolution: shipped
---

## Context

The release pull request for 0.23.0 (#122) failed CI at `pnpm audit --prod
--audit-level high`. Advisories published since 0.22.0 name three
production dependencies:

- `better-auth` 1.7.3 in `apps/api`: an OAuth state can be used as a magic
  link to sign in as another user (critical), and the OAuth proxy lets an
  attacker sign in as another user (high). Fixed in 1.7.7.
- `undici` below 7.30.1, through `@ai-sdk/provider-utils` in the engine:
  certificate validation bypass, cache poisoning across origins, and two
  denials of service (high). Fixed in 7.30.1.
- `zod` 4.5.4 in `apps/api`, the engine and the pipeline: memory
  exhaustion while validating oversized constrained collections (high).
  Fixed in 4.6.6.

The engine and the pipeline pin zod exactly, so their consumers install the
held version until a release moves the pin.

## Acceptance

- [x] `better-auth` is 1.7.15, and `zod` is 4.6.7 in `apps/api`, the engine
      and the pipeline.
- [x] The lockfile resolves `undici` at 7.30.1 or later.
- [x] `pnpm audit --prod --audit-level high` finds nothing.
- [x] Lint, type check, the suite, the build and `release:verify` pass.

## Log
- 2026-11-01T23:42+08:00 — Raised the three versions; `undici` moved inside
  `@ai-sdk/provider-utils`' own range (`^7.29.0`) by a lockfile update. The
  audit keeps 13 moderate and 5 low findings, below the CI bar. The hosted
  repository also depends on `better-auth` and is not changed here.
