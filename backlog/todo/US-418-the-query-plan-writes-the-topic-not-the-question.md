---
id: US-418
title: The query plan writes the topic, not the question
type: feature
priority: p1
created: 2026-09-26T02:07+08:00
parent:
area: ai
resolution:
---

## Context

**The query prompt asks for "what a person with the problem types", and on
Reddit the model answers with the whole question.** Monitors get phrases such
as "can anyone recommend a tool for invoice reminders". The words that make it
a question do no work: the provider matches words one at a time (US-022 saw
`end to end tests keep breaking` return r/islam), so "can", "anyone" and
"recommend" pull posts about everything, and the classifier already finds the
intent without them.

**Radar measured the other side of this (US-413 in signalscout-radar).** It has
no topic, so it must search with question words, and it pays for it: 7–8% of
what "can anyone recommend" returns asks for anything at all. A monitor has a
topic and does not need to pay that.

The owner's X monitor on 2026-09-25 shows the cost: `find leads`,
`find buyers` and `find customers` each fetched 40 posts in one poll and
matched none.

## Acceptance

- [ ] `buildQuerySystemPrompt` tells the model to write the topic and the
      problem in the person's words, and to leave out ask words ("can anyone
      recommend", "what do you use", "looking for"), with the reason
- [ ] The query capture (`ai/fixtures/capture-queries.ts`) is re-run, and
      the Log compares the phrases before and after for the same monitors
- [ ] One monitor's phrases, old and new, are run once each on Reddit and X,
      and the Log gives posts and matches per phrase

## Notes

- `packages/engine/src/ai/queries.ts`, `buildQuerySystemPrompt`.
- Evidence: signalscout-radar `backlog/done/2026-09/US-413-*`.

## Log
