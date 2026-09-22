---
id: BUG-324
issue: 76
title: A long provider wait holds back every platform of a monitor
type: bug
priority: p2
created: 2026-09-23T06:27+08:00
parent:
area: worker
resolution:
---

## Context

When a provider asks to be tried again later, `collect.ts` books a resume
poll with `startAfter` set to that moment, keyed by the monitor. `poll` is a
`stately` queue: one queued job per monitor. A delayed job is queued from the
moment it is sent, so until it runs, every scheduler tick for that monitor is
refused as "already queued". That holds back all of the monitor's platforms,
not only the one that asked to wait.

Nothing bounds the wait. The four provider clients each turn a
`Retry-After` header into a date in their own way:

- `scrapecreators/client.ts` accepts whole seconds only.
- `socialcrawl/client.ts` accepts any positive number, decimals included.
- `socialdata/client.ts` and `apify/client.ts` have their own copies.
- None reads the HTTP-date form of the header, and none has an upper limit.

So `Retry-After: 86400` stops the whole monitor for a day. This is read from
the code and not observed: no provider has been seen to send a long wait.

## Acceptance

- [x] One function in `packages/engine` turns a `Retry-After` header into a
      date, and every provider client uses it.
- [x] It reads both forms of the header: seconds, and an HTTP date.
- [x] It never returns a wait longer than a named maximum, and a test proves
      the limit with `Retry-After: 86400`.
- [ ] A test shows that a monitor with one platform waiting still polls its
      other platforms at its normal interval, or the Log says why the design
      keeps them together.

## Notes

- `packages/pipeline/src/worker/collect.ts`, `wakeNoLaterThan` and the
  `boss.send(pollQueue, …, { startAfter: wakeAt })` call.
- `docs/sources.md` holds the connector rules; the new function belongs
  beside the other shared source helpers.
- The limit is a product choice: a wait longer than a monitor's own interval
  is probably never worth honouring whole.

## Log

- 2026-09-23T06:27+08:00 — Found in a review of the open repository.
- 2026-09-23T07:11+08:00 — Three boxes done by US-334: `retryAfterDate` in
  `packages/engine/src/sources/providers/core.ts`, used by the four clients
  that read the header, with a maximum of one hour and a test for
  `Retry-After: 86400`. The wait that is left is shorter, not gone: a
  monitor's other platforms still wait with the one that asked, for up to an
  hour. The last box is about that.
