---
id: US-201
title: A stage writes down what it did
type: feature
priority: p1
created: 2026-09-18T09:50+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

US-104 gave the poll a row of its own, and the reasoning it was written with
applies to every stage after it. A poll that collected fifty posts this
instance already had and a poll that collected nothing leave the same absence
of rows — and so do a filter that dropped forty posts on triage, a classifier
that scored twelve and matched three, and a classifier that stopped at the cap
with five posts unread. The pipeline's later stages are where the money goes
and where an inbox stays empty, and they leave nothing behind but counters
that have been adding up since the monitor was made.

`filter_drops` holds every drop with its similarity, which is a research
record and not a history: it cannot say which poll a drop belonged to, or that
a stage ran at all. The queue's own job rows say a stage ran, but they are the
queue's to delete and they carry no outcome.

So: one row per stage run, beside `poll_runs`, written by the stage itself at
the point where it already knows everything and logs it. A screen can then
show a collection as what it is — polled, filtered, read, scored, sent — with
what each step did and what it cost.

Four stages write. The poll does not: it has `poll_runs`, and a second row
saying the same thing would be two answers about one job.

## Acceptance

- [x] `stage_runs` holds one row per run of the filter, replies, classify and
      notify steps: the stage, the outcome, what went in, what came out, what
      it spent, and a per-stage detail.
- [x] Every exit of a step writes a row, including the exits that do nothing,
      and the throw each step makes on purpose writes one saying so. An
      unexpected throw — a database that went away mid-step — still leaves no
      row, and the queue's dead letter is what holds that.
- [x] The notifier is the one exception and says why: its sweep runs on a
      schedule over every monitor with settings, so a pass that found nothing
      writes nothing.
- [x] A refusal says why from a closed set — the cap, no model, no key.
- [x] The table is bounded per monitor, the way `poll_runs` is.
- [x] A row carries its owner, so a read can be scoped without a join.
- [x] `readStageRuns` answers for one monitor, newest first, scoped by owner.
- [x] The vocabulary arrays and the check constraints agree, and the
      migration is in the same change.
- [x] The engine and pipeline boundaries are unchanged.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- The step already logs its counts: `deliver` in `filter.ts`, "posts
  classified" in `classify.ts`, "replies finished" in `replies.ts`.
  `processNotifications` returns nothing and has to say what it sent.
- `poll_runs` is the model for the table, the trim and the read.
- The cloud repository shows this, after a release. It cannot be built there:
  the steps live here.

## Log

- 2026-09-18T09:50+08:00 — Written after the inbox and the monitor screens
  learned to say the live stage (cloud US-199, US-200). The history is the
  half they cannot show.
- 2026-09-18T10:01+08:00 — Built it. `stage_runs` beside `poll_runs`, written
  from the one place each step already knows everything and logs it: `deliver`
  in the filter, "posts classified" in the classifier, "replies finished" in
  the replies stage. `processNotifications` now returns what it planned and
  sent, which it had counted and thrown away.
- 2026-09-18T10:01+08:00 — A failed write is swallowed and logged. The work is
  done by the time the row is written, and failing a job over its own history
  would send a batch back through a model that has already been paid for it.
- 2026-09-18T10:01+08:00 — 2079 tests, lint and typecheck pass. The new file
  drives the real steps and reads the rows they leave.
