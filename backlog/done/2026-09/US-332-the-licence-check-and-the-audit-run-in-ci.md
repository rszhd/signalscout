---
id: US-332
issue: 80
title: The licence check and the audit run in CI and pass
type: chore
priority: p3
created: 2026-09-23T06:41+08:00
parent:
area: tooling
resolution: shipped
---

## Context

`pnpm check:licenses` exits 1 today. Vite 8 brought in `lightningcss`, which
is MPL-2.0, and the script refuses a licence nobody has read. CI does not run
the script, so the failure went unnoticed.

`pnpm audit` reports three holes, all in tools rather than in what the image
runs:

- two in `extract-zip`, through `promptfoo`, which only the evals use, with
  no patched version;
- one in `esbuild`'s development server, through `drizzle-kit`, a server
  this application never starts.

A check that nobody runs is a check that fails for months.

## Acceptance

- [x] MPL-2.0 is read and decided: added to `allowed` in
      `scripts/check-licenses.mjs` with what it asks of us, or the
      dependency is dropped.
- [x] `pnpm check:licenses` passes and runs in CI.
- [x] `pnpm audit --prod` runs in CI and fails on a high or critical hole in
      a production dependency.
- [x] Each hole it currently reports is fixed, or accepted in the Log with the
      reason and the path that makes it unreachable.

## Notes

- MPL-2.0 is file-level copyleft: it covers changes to its own files, not
  this repository. `lightningcss` is a build tool here and is not in the image.
- US-318 adds a dependency bot; the two fit together.

## Log

- 2026-09-23T06:41+08:00 — Found in a review of the open repository.
- 2026-09-23T07:58+08:00 — Shipped. **MPL-2.0 is allowed**, with its reason in
  `scripts/check-licenses.mjs`: it is file-level copyleft, which asks
  something only of a changed MPL file, and `lightningcss` is used as it
  ships. `pnpm check:licenses` passes and CI runs it, and CI runs
  `pnpm audit --prod --audit-level high`, which passes today.

  **The audit, as it stands:**

  - `esbuild` ≤ 0.24.2, moderate, GHSA-67mh-4wv8-2f99, through
    `better-auth > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils`.
    **Accepted:** the hole is in `esbuild`'s development server, and no
    process here starts it. It is in the production tree only by the leak
    BUG-338 records.
  - `extract-zip` ≤ 2.0.1, two highs, through `promptfoo >
    @openai/codex-security`. **Accepted:** development only — `promptfoo` runs
    the triage evals on a person's own machine, and the package has no
    patched version. Not in `--prod`, so CI does not see it.

  **What the check found underneath:** the MPL license and the `esbuild`
  advisory both reached the "production" tree the same way — `better-auth`'s
  optional peers resolve to the workspace's development tools, and the image
  installs them. That is BUG-338, with the measurements.
