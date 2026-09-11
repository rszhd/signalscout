---
id: US-116
title: AGENTS.md holds rules, not history
type: chore
priority: p2
created: 2026-09-11T10:40+08:00
area: docs
resolution: shipped
---

## Context

`AGENTS.md` was 2,426 lines and 24,838 words — 44% of every document in the
repository, and more than PLAN.md, STACK.md and all eleven files in `docs/`
put together. `CLAUDE.md` imports it, so every agent session pays for all of
it before the first question is asked.

The growth has one cause. 2,019 of those lines are a single narrative with no
heading, and it is append-only: every closed ticket adds a paragraph and
nothing has ever removed one. Eighty-two commits touched the file in a week.

What those paragraphs hold is evidence, not instruction — prices, live-run
timings, what a provider answered on a particular afternoon. It is worth
keeping and it is already kept twice: in the ticket's own **Log**, and for
each subject in `docs/`. `docs/sources.md` carries the provider table that
the narrative also tells in prose.

Three things follow from a file being read every session. It must hold only
what changes what an agent does next. It must be short enough to be read
rather than skimmed. And it must have a rule that stops it growing again,
because the one that let it reach this size was the absence of one.

The drift is measurable: the sentence introducing the money-spending commands
said "these eleven" above a list of nineteen.

## Acceptance

- [x] The narrative moves to `docs/history.md`, whole and unedited, so no
      measurement is lost
- [x] `AGENTS.md` opens with an orientation short enough to read — what works,
      what fetches what, where the defaults point
- [x] The per-script prose moves to `docs/instruments.md`, and the command
      block keeps every name and every price
- [x] The suite's parallelism notes move to `docs/testing.md`, which is the
      file an agent is already told to read before writing a test
- [x] Three lessons the narrative repeated become rules: an invented URL, a
      TypeScript enum that is also a check constraint, and a route scoped in
      part
- [x] A rule says evidence does not go in this file, and says where it goes
- [x] Every relative link in the moved text still resolves from `docs/`
- [x] Every script named in the command block exists in a `package.json`
- [x] `README.md` names the two new documents

## Notes

- The reading list in *Before you start a task* gained an eighth item rather
  than losing one: the two new documents are read on demand, which is the
  whole point of moving them.
- The stale row in *Decisions that are settled* was corrected while it was in
  front of me — X has had a second provider since US-061 and the table still
  said one of three.
- `docs/history.md` is one file in the order the work happened. Distributing
  its paragraphs into the subject documents that already exist is a better end
  state and a separate ticket, because it is 222 paragraphs of judgement and
  the risk is quietly dropping one.

## Log

- 2026-09-11T10:40+08:00 — Shipped. `AGENTS.md` is 2,478 words against 24,838,
  and holds the eight sections that tell an agent what to do. `docs/history.md`
  is 21,154 words, `docs/instruments.md` 1,751, and `docs/testing.md` gained
  *Running the suite*.

  Nothing was deleted. Every paragraph is in one of the three destinations,
  which is why the acceptance box asks for "whole and unedited" rather than
  for a summary — a summary of a measurement is an argument.

  **The file's own history is the evidence the rule is needed.** Eighty-two
  commits in a week, each adding a paragraph, none removing one. A rule that
  says what to add has to say what to remove, or the next hundred tickets
  rebuild this.
