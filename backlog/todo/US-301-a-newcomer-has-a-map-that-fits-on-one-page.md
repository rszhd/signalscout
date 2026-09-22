---
id: US-301
title: A newcomer has a map that fits on one page
type: chore
priority: p2
created: 2026-09-22T16:32+08:00
parent:
area: docs
resolution:
---

## Context

The documents under docs/ are 62,000 words, and history.md alone is
32,000. They are correct and they were written for an agent: AGENTS.md
says of itself that it is loaded into every session and so holds only what
changes what the agent does next. That is a context-window concern. A
person does not have one.

A person arriving to fix one bug wants ten minutes of reading: what the
processes are, which folder does what, where a request enters and where a
row is written, how to run it, and how to find the reasoning when they
need it. Today CONTRIBUTING.md sends them to AGENTS.md, whose *Before you
start a task* lists seven documents. Each is worth reading. None is the
first one.

The map does not replace anything. It is the page every other page is one
link away from.

## Acceptance

- [ ] `docs/map.md` exists and is under 800 words. It holds: the two
      processes and the one database; the three packages and two apps in a
      sentence each; the path of one poll from the scheduler to a match row,
      naming the file at each step; the path of one HTTP request; the three
      commands to run, test and lint; and one paragraph on where the
      reasoning lives (ticket Context, history.md, the doc per subject) and
      when to go there.
- [ ] Every file it names exists, checked by a test or a script the same way
      links are checked today, so the map cannot rot silently.
- [ ] CONTRIBUTING.md's *Before you write code* names the map first and
      AGENTS.md second, and says which is for whom.
- [ ] README.md's repository table lists it in the first row.
- [ ] Each procedure that lives only in `.claude/skills/` — `add-migration`,
      `capture-fixture`, `cut-release`, `measure-scoring-change` — has its
      steps in a docs/ page a person can follow without the harness, and the
      skill points at that page rather than repeating it. The Log records
      which pages had to be written and which already held the steps.

## Notes

- docs/pipeline.md already holds the poll in order; the map borrows its
  headings and links to it for the detail.
- The word limit is the point. A map that grows into a manual has failed;
  the manual already exists.

## Log

- 2026-09-22T16:32+08:00 — Written after a review of the documents against what a first-time contributor reads, not what a session loads.
