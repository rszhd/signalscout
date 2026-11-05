---
id: US-524
title: Triage can read every post
type: feature
priority: p2
created: 2026-11-05T16:06+08:00
parent:
area: pipeline
resolution:
---

## Context

The pre-filter runs three stages: keywords, embedding similarity and triage.
The first two are free or nearly free and drop most posts. The third is a
model call. When the triage model is very cheap, an application may prefer to
let it read every post, so the two word-based stages cannot drop a lead that
shares no words with the product.

`pre_filter_enabled = false` cannot do this: it turns triage off too. So the
filter step takes a deployment option, `triageOnly`, that skips the keyword
and embedding stages and keeps triage. Unset, the step runs as before, which
keeps the self-hosted default.

## Acceptance

- [x] `startWorker({ triageOnly: true })` skips the keyword and embedding stages.
- [x] Triage still reads every post and still drops what it refuses.
- [x] Unset, all three stages run as before.

## Log

- 2026-11-05T16:06+08:00: Measured before this ticket on a hosted application's stored posts.
  300 posts the keyword and embedding stages dropped went through triage
  (jev-latest, $0.016): 63 kept. The classifier with the US-523 question read
  50 of them and found no match, and a person reading the same 50 agreed. The
  owner chose to turn the two stages off there anyway, to watch real results.
