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
