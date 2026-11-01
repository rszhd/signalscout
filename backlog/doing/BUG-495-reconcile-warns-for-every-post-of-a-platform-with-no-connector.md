---
id: BUG-495
title: Reconcile warns for every post of a platform with no connector
type: bug
priority: p2
created: 2026-11-02T00:26+08:00
parent:
area: pipeline
resolution:
---

## Context

BuyerFinder turned X off in its 0.23.0 deploy, so its registry holds no X
connector, while its inbox still holds X matches from before. Each
reconcile job reads every due match, and for each X post `registry.only`
throws: the job logs "verification skipped: provider choice cannot run" at
warn and moves on. Production printed dozens of these lines a minute on
2026-11-02, and they hid the worker's other lines.

The skip does not count towards `maxChecksPerJob`, so posts of other
platforms are still checked. The cost is the log, and one monitor read per
skipped post per job. A post nobody can verify is never marked checked, so
it stays first in the order and is read again by every job.

A platform with no connector at all is a setting, not a fault. A platform
with two connectors and no choice is a fault, and keeps its warning.

## Acceptance

- [x] A post whose platform has no connector in the registry is left out of
      the job before any per-post read, with no warn line.
- [x] The job logs once, at debug, how many it left out and for which
      platforms.
- [x] A post whose platform has connectors but no single choice still logs
      the warning.
- [x] Tests for both cases in `reconcile.test.ts`, written first: the step
      is correctness-critical.
- [ ] Released as a patch, and BuyerFinder on it.

## Notes

- `packages/pipeline/src/worker/reconcile.ts:103`.
- A patch: nothing a consumer must do.

## Log
- 2026-11-02T00:26+08:00 — Opened from BuyerFinder's production worker log
  after the 0.23.0 deploy.
- 2026-11-02T01:34+08:00 — Built: the job filters out posts of a platform the registry
  has no connector for, and logs their count per platform once at debug. Tests
  first: the no-connector one failed with two warn lines before the change.
