---
id: BUG-019
title: The monitor form reads a key the account may not spend
type: bug
priority: p2
created: 2026-09-12T12:18+08:00
parent: US-081
area:
resolution: shipped
---

## Context

**US-081 stripped the machine's keys from the connections screen and left the
monitor routes reading `process.env`.** So on an instance with signup open and
`BRIGHTDATA_API_KEY` in `.env`, a stranger's monitor form reports no missing
credential, the monitor starts, and the poll then finds nothing — which is
precisely the failure US-010 wrote the readiness rules to prevent, and which
US-081's own acceptance says does not happen.

The path is short. `apps/api/src/start.ts` builds the server without an
`environment`, so `registerMonitorRoutes` is handed `undefined`.
`monitorEnvironment` passes it through, and `startBlockers` in
`packages/core/src/monitors/monitors.ts` defaults the parameter to `process.env`.
Every other reader on that page was given `providerKeyEnvironment(...)` and this
one was given the raw options object.

**Nothing went red, because no monitor-route test runs with signup open.**
`connections.test.ts` and `models.test.ts` both set `AUTH_SIGNUP`; the monitor
tests do not. That is the same shape as BUG-009 — a rule enforced on the routes
somebody remembered and not on the routes nobody counted.

The consequence today is a confusing monitor rather than a spent key: the poll
still refuses, because the worker's lookup was stripped correctly. It becomes a
money bug under [US-128](US-128-a-plan-includes-the-keys-so-nobody-pastes-one.md),
where the same seam decides per account whose keys are spent — which is why this
is worth fixing first and separately.

## Acceptance

- [x] With signup open, a monitor whose only key is in `.env` reports that key
      as missing, on the form and on the monitor list
- [x] Such a monitor is created paused, and the sentence names the key
- [x] With signup closed, nothing changes
- [x] A test runs the monitor routes with signup open, so the gap the fix closes
      is the gap a future change reopens loudly
- [x] Every reader of a provider key in `server.ts` is counted, and each has its
      own case. Count the reads, the way BUG-009 says

## Notes

- The fix is to hand `registerMonitorRoutes` the same `providerKeys` the
  connections and pricing routes already get, and to say in `startBlockers` why
  its `process.env` default is not a safe one for a caller to accept.
- `apps/api/src/start.ts:159` calls `startBlockers` as well, for the boot line.
  That one is about the deployment rather than about an account, and it may keep
  reading the environment — say so where it does.

## Log

- 2026-09-12T12:18+08:00 — Found while reading the machine-key seams for US-128.
  Traced from `start.ts` to the parameter default; not reproduced against a
  running instance.

- 2026-09-12T12:26+08:00 — Fixed. `registerMonitorRoutes` reads the same
  `providerKeys` the connections and pricing routes already read, and
  `MonitorEnvironment.environment` now says why its `process.env` default is not
  a safe one for a caller answering about an account.

  **The reads were counted: three.** The connections routes, the pricing routes
  and the monitor routes. The first two were already right and only the first
  had a case, so the pricing page got one too — the same key, the same
  deployment, two answers. `start.ts`'s own call stays on the environment, and
  it is about the deployment rather than about anybody's account.

  Each new case was watched to fail. Reverting the one line puts two monitor
  tests red — the form reports Reddit ready, and the created monitor starts —
  and reverting the pricing line puts the third red. 2,056 tests pass, lint and
  typecheck are clean. `classify.test.ts` timed out once in the full run and
  passes alone, which is the flake docs/testing.md names.

  **Unproven:** no instance has run with `AUTH_SIGNUP=open` and a key in `.env`
  to watch the form refuse. This is our half, the same gap US-081 recorded.

