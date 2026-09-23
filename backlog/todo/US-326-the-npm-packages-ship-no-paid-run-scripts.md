---
id: US-326
issue: 78
labels: [good first issue, easy]
title: The npm packages ship no paid-run or debugging scripts
type: chore
priority: p3
created: 2026-09-23T06:27+08:00
parent:
area: release
resolution:
---

## Context

`npm pack` of `@signalscout/pipeline` 0.13.1 holds 87 JavaScript files, and
15 of them are scripts, not library code: 14 `live-*` and `measure-*`
instruments, which spend real money when run, and `probe-sc.js`, a
debugging script left in `packages/pipeline/src/` that calls ScrapeCreators
with a fake key. Nothing imports them. They reach every consumer of the
package, the hosted application included, only because `files` publishes all
of `dist`.

## Acceptance

- [ ] `packages/pipeline/src/probe-sc.ts` is deleted.
- [ ] `npm pack --dry-run` of each package lists no `live-*`,
      `measure-*`, `capture` or `probe` file.
- [ ] Every `live:*`, `measure:*` and `capture:*` command in
      `docs/instruments.md` still runs from the repository.
- [ ] `pnpm release:verify` passes.

## Notes

- The `files` field in each `package.json` already excludes tests with a
  `!dist/**/*.test.*` line; the same shape works here.
- Find them with:
  `cd packages/pipeline && npm pack --dry-run --json`.
- `@signalscout/engine` also packs its fixture capture scripts. Check whether
  a consumer needs any of them before removing them.

## Log

- 2026-09-23T06:27+08:00 — Found in a review of the open repository.
