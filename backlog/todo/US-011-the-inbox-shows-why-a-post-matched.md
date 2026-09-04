---
id: US-011
title: The inbox shows why a post matched
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
---

## Context

PLAN.md rejects the analytics dashboard and asks for an inbox. The mockup
there is the specification: a score, the source and age, the post text, a list
of reasons it matched, three sub-scores, and three actions.

The reasons are the part that makes this different from a keyword alert. A
person reading a match decides in about two seconds whether to open it, and
they decide on the reasons, not the number. If the reasons are vague the
product is a noisier version of a saved search.

What this screen must not become: charts, sentiment, share of voice, word
clouds. PLAN.md lists these as out of scope and the list is worth honouring
early, because a dashboard is what everyone reaches for when a screen looks
empty.

Ordering is by score and recency together. A 96 from three days ago is worth
less than an 88 from ten minutes ago, because the conversation is still open.
How much less is a judgement to settle during the work and record here.

## Acceptance

- [ ] A list shows matches with score, source, subreddit or handle, age and an
      excerpt
- [ ] Each match shows the reasons it matched, as specific claims about the
      post
- [ ] Each match shows problem fit, ICP fit and intent
- [ ] Opening the original conversation is one click, in a new tab
- [ ] The list is filtered by monitor and by minimum score
- [ ] Ordering accounts for both score and age, and the rule is written down
- [ ] The list loads and stays usable with several thousand matches
- [ ] No chart, sentiment score, word cloud or share-of-voice appears anywhere
      on the screen

## Notes

- Depends on [US-009](US-009-the-model-scores-a-post-against-a-monitor.md).
- PLAN.md, *Product UX*, holds the mockup and the exclusion list.
- The *Draft reply* action in the mockup is deliberately not in this ticket.
  It is a second model call with its own cost and its own failure modes, and
  the inbox is useful without it.

## Log

- 2026-09-04 — Written from PLAN.md.
