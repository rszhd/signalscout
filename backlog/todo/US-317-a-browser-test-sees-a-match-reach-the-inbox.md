---
id: US-317
title: A browser test sees a match reach the inbox
type: chore
priority: p2
created: 2026-09-23T05:44+08:00
parent:
area: web
resolution:
---

## Context

An agent writes the screens here, and the web tests render components in jsdom.
No test opens the application in a real browser, and AGENTS.md names *screens
no browser has rendered* as a standing gap (US-244). A screen can pass every
component test and still fail to load, to route, or to reach the API.

One smoke test in CI closes most of that gap: create the first account, make a
monitor, run a poll, see a match in the inbox. It must not spend money, so it
needs the fake source and a model that answers without a network.

## Acceptance

- [ ] A Playwright test in CI starts the built API, worker and web against the
      CI Postgres, and runs: first account, project, monitor, one poll, one
      match in the inbox.
- [ ] The poll uses `createFakeSource` and a model stub; no request leaves the
      runner.
- [ ] The switch that selects the fake source and the stub is refused when
      `NODE_ENV=production`, and a test proves the refusal.
- [ ] The job runs in under five minutes, and the Log records the time.

## Notes

- `packages/engine/src/sources/fake/` exists and is exported, but nothing in
  the running application can select it today.
- The model tests use `MockLanguageModelV4` from `ai/test`
  (`packages/engine/src/ai/call.test.ts`).
- US-244 is the manual pass on the same screens; this ticket does not close it.

## Log

- 2026-09-23T05:44+08:00 — Written from a review of the repository as an AI-assisted open-source
  project.
