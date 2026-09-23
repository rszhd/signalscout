---
id: BUG-383
title: One bad query refuses the whole plan
type: bug
priority: p1
created: 2026-09-23T22:59+08:00
parent:
area: engine
resolution:
---

## Context

The query generator asked the model for a plan and validated it against the
full schema in one step. A single line that broke a rule — one query over its
platform's word limit, one repeat, one subreddit that is not a name — refused
the whole plan, and every good query went with it. The form then said the
model "did not write a usable set of queries", and a person could only try
again and pay again.

The reason was also lost. `schemaComplaint` in `call.ts` cut the validation
error to 400 characters, and that error begins with the model's whole reply.
The rule that failed came after the cut, so `model_calls.error` held the
reply and never the reason.

## Acceptance

- [x] A line that breaks a rule is dropped, and the rest of the plan is kept.
- [x] A plan is refused only when a platform keeps fewer than three queries,
      and the error names each dropped line and its rule.
- [x] A subreddit that is not a name is dropped and never refuses a plan.
- [x] A repeat and a line past the limit of eight are dropped.
- [x] A refused answer's error names the rule it broke, not the reply.
- [x] The API logs the dropped lines of a plan it accepted.
- [ ] A real model has written a plan through the new path. Not run: it
      spends a call, and nobody asked for the spend.

## Notes

- `packages/engine/src/ai/queries.ts`: the model now answers a schema with
  the plan's shape only; `usablePlanFrom` applies each line's own rule.
- `packages/engine/src/ai/call.ts`: `schemaComplaint` keeps Zod's issues.
- `QueryPlanOutcome` gains `dropped` on `generated`. The hosted repository
  builds this outcome by hand in four test fakes, which need `dropped: []`
  when it takes the next engine release.

## Log

- 2026-09-23T22:59+08:00 — Found on the owner's instance. Three plans were
  refused in a row, from 14:07 to 14:50 UTC: two on `gpt-5.6-terra` and one
  on `gpt-6-sol`. In two of them, the first Reddit query was nine words, one
  over Reddit's limit of eight. The stored errors stop at 475 characters,
  inside the reply, so the third refusal's reason is unknown. The prompt had
  grown from 744 to 1,347 input tokens since the last plan that passed,
  which fits more platforms asked for in one plan.
- 2026-09-23T22:59+08:00 — Fixed as above. The engine and API suites pass
  (1,131 tests), with five new cases in `queries.test.ts`. Not yet proven
  against a real model.
