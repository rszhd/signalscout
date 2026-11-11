---
id: US-566
title: The filter drops a post older than a deployment's age limit
type: feature
priority: p1
created: 2026-11-11T15:48+08:00
parent: US-557
area: pipeline
resolution:
---

## Context

A Facebook phrase is searched through Google, and Google limits a search to
the past day or the past week, not to a number of days. A first poll with a
3-day window therefore asks for the past week. The connector keeps every
result on purpose: Google shows a post hours after it is written, so an
hourly poll must not cut at its own `since` (US-557).

So a deployment that shows only recent posts pays the embedding stage,
triage and the classifier for posts it will never show. A hosted
application's first search on 2026-11-11 found 9 matches, 4 of them on
Facebook posts 4 to 7 days old, which its results page then hid.

The filter step takes `maxPostAgeDays`. Before any other stage, a post
written more than that many days before the step runs is dropped as
`too_old`. It is a fixed age, not the poll's `since`, so a post Google
listed a few hours late still passes. It applies with the pre-filter off
too: it is the deployment's rule, not a filter the person tunes. Unset, no
post is dropped for its age, as before.

## Acceptance

- [x] `maxPostAgeDays` on the filter step and the worker runtime drops a post
      older than the limit as `too_old`, before the keyword stage, and a
      newer post goes on.
- [x] It drops with the pre-filter off and with `triageOnly` too.
- [x] Unset, an old post goes on as before.
- [x] `too_old` is in `filterStages`, with its migration, and the monitor
      list's per-stage counts leave it out, as they leave out `old_thread`.

## Notes

## Log
