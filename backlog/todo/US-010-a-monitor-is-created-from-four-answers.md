---
id: US-010
title: A monitor is created from four answers
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

PLAN.md is firm that users should not have to become Boolean-search experts.
They answer four questions — what they sell, who buys it, what problem it
solves, which signals matter — and the system writes the queries.

That generation step is not only a convenience. It is a cost lever. A loose
query pulls posts that the filter then discards, and on X every one of those
posts was paid for. Query quality is where a user's bill is decided.

So the generated queries are shown, not hidden. A user can read them, edit
them, and delete one. Hiding them would make a bad bill inexplicable.

The signals list from PLAN.md is a set of checkboxes: recommendations,
alternatives, complaints, problem descriptions, comparisons, purchase intent,
hiring. Each selected signal shapes both the queries and the classifier
prompt, so the two stay consistent — a monitor that searches for hiring posts
and then scores them without knowing hiring counts will reject its own
results.

Subreddit selection is part of this. A query across all of Reddit is far
noisier than the same query in five subreddits, and the model can propose the
subreddits from the ideal-customer answer.

## Acceptance

- [ ] A form collects the four answers and the signal checkboxes from PLAN.md
- [ ] Queries are generated from the answers, and proposed subreddits with them
- [ ] Generated queries are shown to the user, and each can be edited or
      removed before the monitor starts
- [ ] The user's answers and the generated queries are stored separately, so
      queries can be regenerated without retyping
- [ ] The selected signals reach both the query generator and the classifier
      prompt from one place
- [ ] A monitor can be paused and resumed without losing its history
- [ ] A monitor with no valid credentials for its source cannot be started,
      and says which credential is missing

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-009](US-009-the-model-scores-a-post-against-a-monitor.md).
- Related: [US-014](US-014-a-querys-cost-is-known-before-it-runs.md) adds the
  cost estimate to this form. Kept separate because this ticket is useful
  without it on Reddit, where reads are free.
- PLAN.md, *Monitor creation*, for the questions and the signal list.

## Log

- 2026-09-04 — Written from PLAN.md.
