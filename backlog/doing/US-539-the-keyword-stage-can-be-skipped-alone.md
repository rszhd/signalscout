---
id: US-539
title: The keyword stage can be skipped alone
type: feature
priority: p1
created: 2026-11-07T00:30+08:00
parent: US-524
area: pipeline
resolution:
---

## Context

US-524 lets a deployment skip the keyword and embedding stages together, so
triage reads every post. A hosted application did, to watch what the two
stages had been dropping. After a day and a half it had paid triage for
every post, and the owner asked which stage could come back.

Measured on that application's stored data (Log below): the keyword stage
would have dropped 2 of 96 matches, both real leads that name none of the
monitor's words ("Need gift ideas." for a leather gift shop). The embedding
stage alone dropped none of the 96 and 30% of a random 600 posts. So the
filter step takes `skipKeywordStage`: the embedding stage and triage run,
the keyword stage does not. Unset, all three run, as before.

## Acceptance

- [x] `skipKeywordStage` on the filter step and the worker runtime skips only
      the keyword stage; the embedding stage still drops a post below the
      threshold, and triage still runs.
- [x] `triageOnly` still skips both when set.
- [ ] Released, and the hosted application runs it.

## Notes

- `packages/pipeline/src/worker/filter.ts`, `runtime.ts`.

## Log

- 2026-11-07T00:30+08:00 — Measured before the change, on a hosted
  application's production data from 2026-11-05 08:56 UTC (when its keyword
  and embedding stages stopped) to 2026-11-06 16:30 UTC. Both stages rerun
  offline with this repository's own `keywordRuleFor`, `keepsPost` and
  `postEmbeddingText`, and `text-embedding-3-small` against each monitor's
  description text, threshold 0.15. 96 matches on 15 monitors: keyword
  dropped 2, embedding alone 0; the lowest match similarity was 0.216, the
  two keyword drops 0.35 and 0.42. A random 600 posts: keyword dropped 101,
  embedding after keyword 134; embedding alone 179 (30%: Reddit 147 of 475,
  forum 19 of 45, Facebook 13 of 80). Triage there cost about $0.20 a day,
  so embedding alone saves about $0.06 a day. Embedding the test: about
  $0.003.
