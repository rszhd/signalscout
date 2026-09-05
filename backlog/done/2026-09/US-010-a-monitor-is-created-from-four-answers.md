---
id: US-010
title: A monitor is created from four answers
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
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

- [x] A form collects the four answers and the signal checkboxes from PLAN.md
- [x] Queries are generated from the answers, and proposed subreddits with them
- [x] Generated queries are shown to the user, and each can be edited or
      removed before the monitor starts
- [x] The user's answers and the generated queries are stored separately, so
      queries can be regenerated without retyping
- [x] The selected signals reach both the query generator and the classifier
      prompt from one place
- [x] A monitor can be paused and resumed without losing its history
- [x] A monitor with no valid credentials for its source cannot be started,
      and says which credential is missing

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-009](US-009-the-model-scores-a-post-against-a-monitor.md).
- Related: [US-014](US-014-a-querys-cost-is-known-before-it-runs.md) adds the
  cost estimate to this form. Kept separate because this ticket is useful
  without it on Reddit, where reads are free.
- PLAN.md, *Monitor creation*, for the questions and the signal list.

### Present, not valid — closed by the connections screen

This box stayed open because the form checked that a key was *present*, not
that it *worked*, and the argument for leaving it that way still holds: a
resume that validated with the provider would be refused by a provider outage
that has nothing to do with the key.

[US-023](../done/2026-09/US-023-a-provider-key-is-pasted-tested-and-stored.md)
built the screen the answer belongs on. A key is now tested with the provider
where a person pastes it, and a key the provider refuses is never stored. So
"valid" is enforced at the only moment a person can act on the answer, and this
form still asks the cheap question — is there a key at all — without making a
network call.

The path was run live on 2026-09-05: a monitor created with no credential was
paused, its resume was refused naming `REDDIT_API_KEY`, the key was stored
through the connections screen, and the same resume then succeeded in the same
process.

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

- 2026-09-04T22:49+08:00 — Written from PLAN.md.
- 2026-09-05T02:49+08:00 — Built the server half: `monitors/signals.ts` as the one place
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
- 2026-09-05T03:27+08:00 — Built the React form and its jsdom harness. The form reads the
  signal labels and source readiness from the API, sends the four answers to
  query generation, and shows every generated query and subreddit as an
  editable, removable field before creation. A deployment with no model offers
  manual query entry. A missing source credential saves the answers in a
  paused monitor and names the environment variable, but does not validate the
  key with the provider. The credential acceptance box stays open for the
  connection-testing screen described above.
- 2026-09-05T15:16+08:00 — Closed. The last box was waiting for a place to test a
  credential with the provider, and US-023 built it. Nothing in this ticket's
  code changed; what changed is that "valid" now has a screen that enforces it,
  and the reasoning for keeping the probe out of the resume path is written in
  the Notes above rather than left as an open box.
