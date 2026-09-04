---
id: US-015
title: A deleted post stops being shown
type: feature
priority: p2
created: 2026-09-04
parent:
area:
resolution:
---

## Context

Reddit's terms require that content the author removed stops being shown.
Storing a permanent copy of every post and serving it forever breaks that,
and it breaks it for every self-hoster at once, using credentials they
registered in their own name.

This is a correctness and compliance concern, not a feature. It is written
early because the column it needs is cheap now and expensive later: adding
`last_verified_at` to a table full of matches means backfilling a null and
deciding what a null means.

The design is a reconciliation job. It re-checks matched posts on a schedule,
oldest verification first, and hides the ones that are gone or deleted. Hidden
rather than deleted, because the score, the reason and the user's feedback are
our own records and remain useful.

Cost is the constraint. On Reddit a re-check is free. On X it costs $0.005 per
post, which means verifying a thousand matches costs $5. So the job checks
recent and unread matches often, older ones rarely, and on a metered source it
draws from the same budget as everything else — a re-check that pushes a
monitor past its cap must lose to the poll.

## Acceptance

- [ ] `last_verified_at` is set whenever a match is checked
- [ ] A scheduled job re-checks matches, oldest verification first
- [ ] A post that is gone, deleted or removed is hidden from the inbox
- [ ] A hidden match keeps its score, its reason and its feedback
- [ ] Only an id and an excerpt were ever stored, so hiding removes what is
      shown rather than what was retained
- [ ] Re-check frequency differs by match age and by whether it was read
- [ ] On a metered source, re-checks consume budget and are refused when the
      cap is reached
- [ ] A source outage does not hide matches; only a definite deletion does

## Notes

- Depends on [US-005](US-005-reddit-returns-candidate-posts.md) and
  [US-011](US-011-the-inbox-shows-why-a-post-matched.md).
- STACK.md, *Honor deletions*.
- Failing open is the rule. An unreachable API is not a deletion, and treating
  it as one empties a user's inbox during an outage.

## Log

- 2026-09-04 — Written from STACK.md.
