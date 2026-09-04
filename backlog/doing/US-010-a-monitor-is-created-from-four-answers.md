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
- [x] Queries are generated from the answers, and proposed subreddits with them
- [ ] Generated queries are shown to the user, and each can be edited or
      removed before the monitor starts
- [x] The user's answers and the generated queries are stored separately, so
      queries can be regenerated without retyping
- [x] The selected signals reach both the query generator and the classifier
      prompt from one place
- [x] A monitor can be paused and resumed without losing its history
- [ ] A monitor with no valid credentials for its source cannot be started,
      and says which credential is missing

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-009](US-009-the-model-scores-a-post-against-a-monitor.md).
- Related: [US-014](US-014-a-querys-cost-is-known-before-it-runs.md) adds the
  cost estimate to this form. Kept separate because this ticket is useful
  without it on Reddit, where reads are free.
- PLAN.md, *Monitor creation*, for the questions and the signal list.

### Present, not valid

The credential box stays open on purpose. What is built refuses to start a
monitor whose source has no credentials and names the environment variable to
set. It does not ask the provider whether the key works.

`SocialSource.validateCredentials` can answer that, and on Reddit it is free:
the probe sends an empty input list, which cannot start a collection. Two
reasons it is not called here. A resume would then make a network call, so a
provider outage would refuse a resume that has nothing wrong with it. And the
answer belongs where a person can act on it, next to the field they paste the
key into, which is the connections screen and not this form.

Close this box when that screen exists, or when the form gains a "test this
connection" step.

### Query generation has never met a model

`ai/queries.ts` is driven by a stub in the suite. `capture:queries` is
committed and unrun: it needs a real key, and until somebody runs it there is
no evidence about what a model writes from these four answers. The schema
rules are evidence about our parser only.

### The classifier prompt changed

The signals now reach the classifier as a labelled line each, from
`monitors/signals.ts`, instead of as bare ids. The fixtures in `ai/fixtures/`
were captured against the older prompt. Re-run `capture:classifier` and put the
numbers here before treating those scores as current.

## Log

- 2026-09-04 — Written from PLAN.md.
- 2026-09-05 — Built the server half: `monitors/signals.ts` as the one place
  both prompts read, `ai/queries.ts` for the generated queries and subreddits,
  `monitors/monitors.ts` for the writes, and the routes in `apps/api`.
  Migration 0004 adds `monitors.paused_at` and `model_calls.purpose`.

  Three decisions worth keeping. A monitor whose source has no key is
  **created and paused**, not refused: four answers a person just typed are
  not worth throwing away over a key they can paste in a minute, and the
  response names the variable. `paused_at` is read by `findDueMonitors`, so a
  pause is a promise about money and not a UI state. And `model_calls` gained
  a `purpose`, because the form is the second thing in the product that spends
  the user's key, and a bill page that cannot tell the two apart cannot answer
  the question it exists for.

  The form itself is the next pass, with the jsdom test harness docs/testing.md
  assumes. Two boxes stay open, and the Notes above say what each one needs.
