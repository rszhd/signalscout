---
id: US-337
issue: 85
title: A pipeline step reads as its phases
type: chore
priority: p3
created: 2026-09-23T06:46+08:00
parent:
area: worker
resolution:
---

## Context

Each pipeline step is one function: collect is 865 lines with nesting eight
deep, replies 624 lines and nine deep, filter 490, classify 452. They are the
correctness-critical parts — the budget guard, deduplication, the cursors —
and every change to them is read in full because no smaller piece has a name.

The phases already exist inside them. Collect, for one: choose the provider,
read the source, store the posts, book the resume.

## Acceptance

- [ ] One step at a time, each in its own pull request, starting with
      replies. The step's body calls named phases and holds no nesting deeper
      than four.
- [ ] No test's expected value moves. A value that moves is a bug in the
      split.
- [ ] The full suite passes after each step, and the Log records its time
      before and after.

## Notes

- Do this after the open security fixes land, so a large diff does not hide
  them.
- `packages/pipeline/src/worker/{collect,replies,filter,classify}.ts`.
- A file header holds the contract and the phases take their names from it
  (AGENTS.md, *A file header holds the contract, not the story*).

## Log

- 2026-09-23T06:46+08:00 — Found in a review of the open repository.
- 2026-09-23T07:24+08:00 — **Replies done; filter, classify and collect remain.** The step body
  is now a list of phases: `refuseAtCap`, `readThreads`, `connectorsFor`,
  then per thread `judgeLastBatch`, `readBatch` and `recordProgress`. The
  short skip rules stay in the loop, in their old order, because each is one
  sentence of policy and reads best where it is decided.

  Measured: the step went from 624 lines to 339 (339 code lines to 193), and
  its control flow from nine levels to a loop and one `if`. The only lines
  deeper than four are one call's arguments, placed there by the formatter.
  Every comment line of the old file is in the new one, checked by diffing
  the sorted comment lines; one block the first cut dropped was put back. A
  misplaced block now sits on the code it describes: *Which provider fetches
  each platform* moved from above the date floor to `connectorsFor`.

  No test file changed. Worker tests: 21 files, 279 tests. Full suite: 133
  files, 2,331 tests. `replies.test.ts` took 40.9 s before and 40.6 s
  after, the same within noise. `readBatch` returns its units and stored
  ids instead of adding to the run's totals page by page; when a page throws
  the job fails either way and the totals are never written, so nothing a
  test or a person can see moved.
