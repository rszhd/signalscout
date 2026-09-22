---
id: US-301
issue: 56
title: A newcomer has a map that fits on one page
type: chore
priority: p2
created: 2026-09-22T16:32+08:00
parent:
area: docs
resolution: shipped
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

- [x] `docs/map.md` exists and is under 800 words. It holds: the two
      processes and the one database; the three packages and two apps in a
      sentence each; the path of one poll from the scheduler to a match row,
      naming the file at each step; the path of one HTTP request; the three
      commands to run, test and lint; and one paragraph on where the
      reasoning lives (ticket Context, history.md, the doc per subject) and
      when to go there.
- [x] Every file it names exists, checked by a test or a script the same way
      links are checked today, so the map cannot rot silently.
- [x] CONTRIBUTING.md's *Before you write code* names the map first and
      AGENTS.md second, and says which is for whom.
- [x] README.md's repository table lists it in the first row.
- [x] Each procedure that lives only in `.claude/skills/` — `add-migration`,
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
- 2026-09-22T19:50+08:00 — Shipped. `docs/map.md`, 727 words: the two processes and the database, the five folders with the boundary tests that hold them, one poll from the clock to the notification naming a file per step, one request and the scoping rule, the four commands, and where the reasoning lives. CONTRIBUTING.md names it first and AGENTS.md second; AGENTS.md gained a step 0 pointing back at it.
- 2026-09-22T19:50+08:00 — `apps/api/src/docs-map.test.ts` keeps it honest. It reads every backticked span with a slash and every relative link, and fails when one names nothing. A span may be a readable tail — `worker/collect.ts` — so it passes when a real path ends with it, which is what a reader does with it. Proved by renaming `worker/collect.ts` in the map: the test failed and named the span. It also holds the 800-word limit, because a map that grows into a manual has failed.
- 2026-09-22T19:50+08:00 — Two of the four skills held a procedure no document did. `add-migration`'s six steps are now *Adding a migration* in docs/pipeline.md, and `capture-fixture`'s seven are *Capturing one, in order* in docs/sources.md. Both skills point there and keep only the traps that have actually cost something here. `cut-release` and `measure-scoring-change` needed nothing: docs/releasing.md's *Cutting one* and docs/instruments.md's *A change that can move a score is measured before it ships* already held their steps, and each skill already said so.
