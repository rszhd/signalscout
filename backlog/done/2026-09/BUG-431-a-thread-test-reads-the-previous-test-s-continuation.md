---
id: BUG-431
title: A thread test reads the previous test's continuation
type: bug
priority: p2
created: 2026-09-27T11:18+08:00
parent:
area: tests
resolution: shipped
---

## Context

The release PR for 0.17.1 (#116) failed CI in `classify.test.ts`, "sends the
parent thread back once per batch of replies": the continuation it read named
a different thread (run 36290614249). The code under test was not changed in
that release.

**The cause is ordering between tests, not in the step.** The classify step
sends the notify job and then the replies job (`classify.ts`, after
`sendNotify`). "never treats two replies as copies", added by US-400 in
0.17.0, classifies two replies and waits only for notify. On a slow runner its
replies job is picked up after `beforeEach` has emptied `continued`, and the
next test reads it as its own.

This is not BUG-021's timeout. Nothing was dropped; a job arrived late.

## Acceptance

- [x] Both thread tests read only their own monitor's continuations
- [x] With the fake replies step delayed 500 ms, the old test fails and the
      new one passes
- [x] `classify.test.ts` passes three runs in a row locally

## Notes

- The fix is in the test: `continuedFor(monitorId)`. The step's order is
  correct and stays: the matches are written and notified before a thread is
  offered again.

## Log

**2026-09-27T11:18+08:00** Reproduced by delaying the fake `replies` step
500 ms: the old test failed, the new test passed. Without the delay, the job
lands before the earlier test ends on a local machine, which is why it passed
locally and failed only on CI.
