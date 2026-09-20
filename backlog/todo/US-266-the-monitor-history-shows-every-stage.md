---
id: US-266
title: The monitor history shows every stage
type: feature
priority: p2
created: 2026-09-20T09:05+08:00
parent:
area: web
resolution:
---

## Context

The monitor page's history is a list of polls, and a poll is the first of
five stages. What a person waits for after it, the pre-filter, the triage,
the threads, the classifier, left nothing on the screen, so the history stops
at "72 posts, 12 new" and never says that three of them matched or that the
cap stopped the rest.

The pipeline has recorded this since 0.5.0. US-201 gave every stage a row in
`stage_runs`, US-203 said which collection it belongs to, US-211 said which
poll it came from, and US-206 counted what a classification scored.
`readStageRuns` is exported from the package and this application never
calls it. The package records it for nobody.

Decisions the hosted application made as US-202, 204, 209, 210, BUG-024 and
BUG-025, and which hold here:

- One list, grouped by poll, newest first inside and out. One list cannot be
  read in two directions.
- A history row describes *this* poll, not *the last* poll. `pollSummary`
  takes a subject.
- Notification delivery is not collection work and stays out of the list.
- `poll_runs` keeps 200 rows per monitor and `stage_runs` keeps 800, so the
  merged list thins at the bottom. It says so rather than pretending older
  polls had no stages.

## Acceptance

- [ ] `GET /api/monitors/:id/activity` returns polls and their stages as one
      collection, newest first, and a test proves the order at both levels.
- [ ] A test scopes the read to the monitor's owner.
- [ ] Each stage line says what it did in a sentence: posts dropped and by
      which rule, threads read, posts scored and how many matched, the cap
      that stopped it.
- [ ] Every history row reads "This poll", and only *Current activity* reads
      "Last poll"; a test pins both callers.
- [ ] The list says where the stage record ends when the polls go further
      back.
- [ ] The read is under `maxStageRunsRead` and the screen pages past it.

## Notes

- `packages/pipeline/src/index.ts:272` — `readStageRuns`; `:261`
  `maxStageRunsRead`; `type StageRunDetail`.
- `apps/web/src/monitor.tsx:281` — `pollSummary`; `:338` `PollHistory`.
- Cloud repository: `apps/api/src/monitors/detail.ts` (the `/activity`
  route) and `MonitorHistory`, `activityGroupsOf`, `stageLine` in its
  `monitor.tsx`.
- Depends on US-265 for the shared status rule; can be built after it.

## Log

- 2026-09-20T09:05+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
