---
id: US-542
title: A deployment may exempt a monitor from the match cap
type: feature
priority: p1
created: 2026-11-07T11:08+08:00
parent: US-490
area: pipeline
resolution:
---

## Context

US-443 and US-490 cap the matches of a collection with two numbers,
`firstMatchesPerCollection` and `matchesPerCollection`, set once for the
whole worker. A hosted application asked for a paying account's searches to
have no cap: they read every post to the end of the collection, while free
searches keep the cap.

The pipeline does not know who pays, so `startWorker` takes `noMatchCap`, a
function of the monitor id. A monitor it answers true for has no cap on any
walk, whatever the numbers say. The classify, replies and complete steps all
ask it, because all three stop at the cap. It is asked at each check, so a
monitor that starts or stops paying changes at its next batch. A throw fails
the job, which retries; it never lifts a cap. Unset, every monitor takes the
caps, as before.

## Acceptance

- [x] `noMatchCap` on `startWorker`, the classify, replies and complete steps.
- [x] An exempt monitor makes every match on its first walk and on later
      walks; a monitor it answers false for keeps the cap.
- [x] The replies and complete steps read an exempt monitor's threads and
      pages after its walk has its matches.
- [ ] Released, and the hosted application runs it.

## Notes

- `packages/pipeline/src/worker/match-cap.ts`, `classify.ts`, `replies.ts`,
  `complete.ts`, `runtime.ts`; `docs/pipeline.md`.

## Log

- 2026-11-07T11:08+08:00 — Built. The three test files pass (53 tests),
  typecheck and lint pass. Not committed or released.
