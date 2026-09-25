---
id: US-421
title: A slow input is not read on every poll
type: spike
priority: p2
created: 2026-09-26T02:07+08:00
parent:
area: pipeline
resolution:
---

## Context

**A read is billed whether it finds anything new or not.** Radar read 27
subreddits every hour and would have spent about $2.40 a day on reads alone,
most of which found nothing new. Most of those subreddits get fewer than one
page of new posts in three hours; reading them every third hour, one page
each, cut the cost by about 80%.

**Whether SignalScout has the same waste is not known.** This spike answers it
before anything is built: how often a monitor's phrases and subreddits are
read, and how many of those reads return no new post.

## Acceptance

- [ ] The Log says how the scheduler decides when each input of a monitor is
      read, with file and line
- [ ] From production (read only), the Log gives the share of reads per
      platform that returned no new post in the last 7 days, and what they cost
- [ ] The Log says whether reading slow inputs less often is worth a ticket,
      and at what pace

## Notes

- Radar's version: signalscout-radar `src/worker/run.ts`, `everyHours`.
- `api_usage` and `post_discoveries` should hold what the count needs.

## Log
