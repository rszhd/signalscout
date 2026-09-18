---
id: US-225
title: Relevance decides whether a score counts
type: bug
priority: p1
created: 2026-09-18T22:40+08:00
parent: US-224
area: engine
resolution: shipped
---

## Context

`classification.ts` has said for a year that "relevance keeps an off-topic post
out". It did not. Relevance was one weighted part of five at 0.2, against
intent at 0.35 and urgency at 0.1, so a post could be scored **0 for relevance
and 0 for problem fit** by the classifier and still become a match on the
strength of wanting something else urgently.

Found in a live inbox, not in a test. A monitor for a social listening tool had
matched:

| score | relevance | problem fit | post |
|---|---|---|---|
| 42 | 0 | 0 | "Free trial vs Free plan" |
| 31 | 0 | 0 | "What can I do to stop these loan offer emails?" |
| 35 | 8 | 5 | "Client database app where you can add photos?" — carpet cleaning invoices |
| 34 | 15 | 5 | "Cheap logging for low RPU?" — a Mixpanel bill |

Four of its seventeen matches. In every one the model was right about the post
and the arithmetic overruled it.

## What changed

`leadScore` multiplies the weighted total by `relevanceGate(relevance)`: 1 at
or above `relevanceFloor`, and proportional below it.

40 is chosen so that nothing on topic moves. PLAN.md's four worked examples
score 45, 94, 95 and 98 for relevance, so all four totals are unchanged —
including `low-intent`, which keeps its 10 and stays below the threshold for
the reason it always did.

A ratio rather than a cliff, so no single point of relevance decides a match.
The fall below the floor is steeper than the gate alone, because relevance is
in both halves: still one of the five weighted parts, and now the multiplier as
well.

On the inbox that exposed it, at that monitor's bar of 30: 18 matches become
12. The three highest — 77, 54, 52 — do not move.

## Acceptance

- [x] A post scored 0 for relevance scores 0 overall.
- [x] Nothing at or above the floor changes.
- [x] The four worked examples are unchanged, `low-intent` included.
- [x] The two live posts that exposed it are the test.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- **This fixes the arithmetic, not the judgement.** The same inbox ranks a
  founder's retrospective — relevance 80, asking for nothing — first at 77,
  where an independent reading puts it at 34. A gate cannot reach that. It is a
  prompt or a model question and it is still open.
- The floor is a stated default like the weights beside it, not a measured one.
  `capture:classifier` is the instrument to re-run before moving it.

## Log

- 2026-09-18T22:40+08:00 — Found while comparing the classifier's scores on a
  live inbox against an independent reading of the same 17 posts. Four of the
  five largest disagreements were this, not the model.
