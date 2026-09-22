---
id: US-332
title: The licence check and the audit run in CI and pass
type: chore
priority: p3
created: 2026-09-23T06:41+08:00
parent:
area: tooling
resolution:
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

- [ ] MPL-2.0 is read and decided: added to `allowed` in
      `scripts/check-licenses.mjs` with what it asks of us, or the
      dependency is dropped.
- [ ] `pnpm check:licenses` passes and runs in CI.
- [ ] `pnpm audit --prod` runs in CI and fails on a high or critical hole in
      a production dependency.
- [ ] Each hole it currently reports is fixed, or accepted in the Log with the
      reason and the path that makes it unreachable.

## Notes

- MPL-2.0 is file-level copyleft: it covers changes to its own files, not
  this repository. `lightningcss` is a build tool here and is not in the image.
- US-318 adds a dependency bot; the two fit together.

## Log

- 2026-09-23T06:41+08:00 — Found in a review of the open repository.
