---
id: US-070
title: A reply is drafted by a model of its own
type: feature
priority: p2
created: 2026-09-08T12:10+08:00
parent: US-068
area:
resolution: done
---

## Context

US-068 gave a person three cards — scoring, triage, similarity — and left the
API's three model calls on the classifier's settings. `db/schema.ts` said why:
*"a person choosing a model for 'writing my queries' separately from 'reading my
posts' is a decision nobody has asked for."*

The owner has now asked, for one of the three. Drafting is the one where it
makes sense, and the reason is in US-040: a draft is the only model output that
carries a person's name into somebody else's conversation, and this product
never posts it. Scoring wants a model that reads carefully and answers in
numbers. Drafting wants one that writes like a person. They are not the same
job, and on some providers they are not the same model.

Query generation and project describing stay on the classifier's settings. Both
produce input for a person to edit before anything is spent on it, and neither
has anybody's name on it.

The shape is triage's, exactly. A `draft` row overrides the environment, the
environment gains `AI_DRAFT_*`, and a new `draftConfigFromEnvironment` falls
every setting back to the classifier's — including the rule that the *price*
does not fall back once a model is named, because a different model billed at
the classifier's rate misreports what a draft cost.

## Acceptance

- [x] A fourth card on the Models screen: provider, model, key, base URL
- [x] Unset falls back to the scoring model's settings, key included, and only
      within one provider
- [x] The price does not fall back once a draft model is named
- [x] `AI_DRAFT_*` lets the instance set it too, and is documented
- [x] A draft is written with the settings of the person who pressed the button
- [x] The cost of a draft is still recorded under `draft_reply`, priced by
      whatever model wrote it

## Notes

- Migration: the `ai_settings_task_known` check gains a value. US-057 and
  US-040 both shipped a value added to a TypeScript array and not to the
  database's constraint; that is the mistake to not make a third time.

## Log

- 2026-09-08T12:10+08:00 — Written after the owner asked for a card for reply
  drafting, one message after US-068 closed with three.
- 2026-09-08T12:12+08:00 — Migration 0047 exists only to widen a check
  constraint, and that is the point of it. `aiTasks` gaining a value is not the
  database gaining one, and this repository has shipped that mistake twice —
  `apify` in US-057 and `draft_reply` in US-040 — both found by a live run
  after the money was spent, with the whole suite passing.
- 2026-09-08T12:14+08:00 — `draftConfigFromEnvironment` is triage's function
  with different variable names, and the copied rules are asserted rather than
  assumed: the key falls back only within one provider, and the price falls back
  only while no model is named. The second one matters here for a reason it does
  not for triage — a draft's cost is shown to the person who pressed the button,
  so a wrong price is a number they read rather than a number in a table.
- 2026-09-08T12:15+08:00 — `draftConfigForEnvironment` in `server.ts` now checks
  the key on **the provider that will be called**, not on the classifier's. A
  person drafting on Anthropic while scoring on OpenAI would otherwise be told
  drafting was available because their OpenAI key exists.
- 2026-09-08T12:18+08:00 — Closed. 1,447 tests pass. Migration 0047 applied to
  the development database.

  Query generation and project describing stay on the classifier's settings,
  and that is a decision rather than an omission: both produce input a person
  edits before anything is spent on it, and neither has anybody's name on it.
