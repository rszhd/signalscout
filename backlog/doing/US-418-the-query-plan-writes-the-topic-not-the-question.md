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

- [x] `buildQuerySystemPrompt` tells the model to write the topic and the
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

**2026-09-27T21:03+08:00** Production data (the cloud, 24 to 27 Sep, 5
monitors, all the owner's) read before the change. Within the same monitor,
1–2 word queries found more posts and more matches per query than longer
ones in 3 of 4 cases: SignalScout on X 788 posts and 6.25 matches a query
against 40 and 0.57; SignalScout4 on Reddit 595 and 5.33 against 216 and
0.57. The match rate was about 1% for both, and the cost per match about the
same (estimated: X at $0.0002 a post, triage at $0.000095 a post). Not
better leads: every match from a short query scored 74 or less, and queries
gave one strong lead in the three days. Subreddits gave 69 matches, queries
53.

The prompt now asks for the topic in the person's words, without ask words,
two or three words, and the best query first. Best first is for any consumer
that runs fewer queries than the model writes; the cloud keeps one a
platform on the first press (its US-285). The Reddit note and hint no longer
say a longer phrase can match; the eight-word ceiling stays.

