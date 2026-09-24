---
id: US-361
issue: 104
title: One command says why a post is not in the inbox
type: feature
priority: p2
created: 2026-09-23T14:32+08:00
parent:
area: pipeline
resolution:
---

## Context

"Why is this post not in my inbox?" is the most common question about the
pipeline. The answer is already stored: `filter_drops` holds the stage and
the similarity, `model_calls` holds the triage and classifier calls,
`stage_runs` holds the run, and `matches` holds the score. No command joins
them for one post, so each answer is a set of hand-written queries.

The same command helps the evals: a label that looks wrong can be checked
against what each stage decided.

## Acceptance

- [ ] `pnpm why <post id or URL>` prints, in pipeline order: the run that
      fetched the post, each stage it passed or failed, the similarity, the
      triage answer and confidence, the score, and the threshold it was
      compared with
- [ ] A post that was never fetched says so, and names the monitors and
      platforms that could have fetched it
- [ ] It reads the database only, calls no provider and spends nothing
- [ ] A test covers a dropped post, a kept post and an unknown post

## Notes

Check the owner: it reads `user_id` from the rows and must not show another
account's post on a shared instance.

## Log

- 2026-09-23T14:32+08:00 — Written from a review of the development loop.
