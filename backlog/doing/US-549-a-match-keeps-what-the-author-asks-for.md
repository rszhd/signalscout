---
id: US-549
title: A match keeps what the author asks for
type: feature
priority: p2
created: 2026-11-08T14:14+08:00
area: pipeline
resolution:
---

## Context

The classifier writes `asks` on every post it scores: what the author is
asking for or needs, in one short sentence (US-523). The pipeline reads it
only to log a post dropped as no fit. A match row keeps the scores and the
reasons and throws the sentence away.

A hosted application wants to show that sentence on each match card, as a
plain line that says what the person wants. The model already wrote it and
was paid for it, so keeping it costs one column and no call.

So `matches` gets an `asks` column, written with the scores on insert and on
re-classification. It is null on a row written before the column existed;
nothing fills those, because the sentence was never stored.

## Acceptance

- [x] `matches.asks` exists, `text`, null allowed, in a pipeline migration.
- [x] A new match stores the classifier's `asks`.
- [x] A re-classified match has its `asks` rewritten with its scores.
- [ ] The release that carries it is a minor version: it has a migration.

## Notes

Only one code path writes a match row: `writeMatch` in
`packages/pipeline/src/worker/classify.ts`, through `scoreColumns`.

## Log

2026-11-08T14:22+08:00 — `asks` added to `scoreColumns`, column in migration 0079. Both classify tests fail without the change and pass with it; the full suite passes (2864).
