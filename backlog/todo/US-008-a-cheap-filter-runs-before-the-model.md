---
id: US-008
title: A cheap filter runs before the model
type: feature
priority: p2
created: 2026-09-04
parent:
area:
resolution:
---

## Context

PLAN.md puts a cheap pre-filter between collection and the AI engine. Its job
is to keep the model bill low, which is the whole basis of the bring-your-own-
key promise: a user who is billed heavily for noise stops running the monitor.

Two stages, both inside Postgres:

1. **Keyword and subreddit match.** Free. Removes the obvious misses.
2. **Embedding similarity with `pgvector`.** The monitor description is
   embedded once. Each surviving post is embedded and compared. Everything
   below a threshold is dropped.

An embedding call costs roughly one hundredth of a classification call, so
stage two pays for itself whenever it drops more than a few percent.

The threshold is the risk. Set too high, it discards good leads before anyone
sees them, silently — and a silent false negative is worse than a noisy inbox,
because nobody can tell it happened. So the threshold is settable, it starts
permissive, and dropped posts are recorded with their score for a period, so
the setting can be judged against real data rather than intuition.

Note the order this sits in. On X, the money was already spent at fetch time.
The pre-filter saves the model bill, not the source bill. Query precision is
what saves the source bill, and that is [US-014](US-014-a-querys-cost-is-known-before-it-runs.md).

## Acceptance

- [ ] Keyword and subreddit matching runs first and costs nothing
- [ ] Monitor descriptions are embedded once and re-embedded when the monitor
      is edited
- [ ] Surviving posts are embedded and compared with `pgvector` cosine distance
- [ ] The threshold is settable per monitor and starts permissive
- [ ] A dropped post is recorded with its similarity score, so the threshold
      can be reviewed against real data
- [ ] A counter shows, per monitor, how many posts each stage dropped
- [ ] Embedding failures do not drop a post; the post goes to the model
      instead, and the failure is logged
- [ ] Turning the pre-filter off entirely is a setting, and the pipeline still
      works

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-007](US-007-the-worker-runs-jobs-on-a-schedule.md).
- STACK.md, *The pre-filter*.
- An embedding failure must fail open, not closed. A dropped good lead is
  invisible; an extra model call is merely a cost.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
