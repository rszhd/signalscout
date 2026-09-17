---
id: US-157
title: A consumer's tests can insert a monitor
type: chore
priority: p2
created: 2026-09-16T20:55+08:00
parent: US-151
area: architecture
resolution: shipped
---

## Context

**The first consumer copied a helper the pipeline should have exported.**
When US-155 built the cloud repository from `apps/api`, one test —
`notifications.test.ts` — reached into `packages/pipeline/src/worker/testing.ts`
for `insertMonitor`, a path that does not exist once the pipeline comes from
npm. The cloud repository carries a copy of the function for now. A copy of a
test helper is the one duplication that drifts unnoticed, because nothing
fails when the two disagree; a monitor inserted with yesterday's columns
still inserts.

**`@signalscout/pipeline/testing` is where it belongs.** That entry point
already exists for exactly this reason — `createTestDatabase` is there
because a consumer's tests start at real Postgres like ours do — and a test
that has a database needs a row to hang on. `insertMonitor` moves from the
worker's private helpers to the public testing index, with `fastRetries`
beside it for the same reason; `fakeRegistry` stays, because it names the
fake source the pipeline's own tests use and a consumer has its own
connectors to fake.

**Then a version.** The change is one export, but a consumer can only reach
it through a release, so this ticket ends with `v0.1.1` and the cloud
repository pinned to it, its copy deleted.

## Acceptance

- [x] `@signalscout/pipeline/testing` exports `insertMonitor` and
      `fastRetries`; the pipeline's own tests import them from there or from
      the file that defines them, and the definition lives once.
- [x] `pnpm release:verify` still passes, and its probe imports
      `insertMonitor` from the packed tarball.
- [x] `v0.1.1` is on npm for both packages, and `docs/releasing.md`'s table
      names it.
- [x] The cloud repository pins `0.1.1`, imports `insertMonitor` from the
      package, and its copy is gone; its suite passes.

## Notes

* `packages/pipeline/src/worker/testing.ts` — the definition today.
* `packages/pipeline/src/testing/index.ts` — the public entry point.
* `apps/api/src/testing.ts` in the cloud repository — the copy to delete.

## Log

- 2026-09-16T20:55+08:00 — Written after the cloud repository's first
  install found the gap.
- 2026-09-16T21:55+08:00 — v0.1.1 published; the cloud repository pins it, imports insertMonitor from the package, its copy is gone, its suite passes, and production runs on it.
