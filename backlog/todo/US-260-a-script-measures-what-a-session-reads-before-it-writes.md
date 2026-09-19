---
id: US-260
title: A script measures what a session reads before it writes
type: chore
priority: p2
created: 2026-09-20T02:30+08:00
parent:
area: tooling
resolution:
---

## Context

Eight documents were cut between 2026-09-19 and 2026-09-20 and every claim
about the result was a word count. A word count says a file is smaller. It
does not say a session paid less, and the two can disagree: a document
nobody loads costs nothing however long it is, and one paragraph that sends
an agent to read three more files costs more than its own length.

`scripts/context-cost.mjs` reads Claude Code's own transcripts under
`~/.claude/projects/` and reports, per task, the context the model carried
when it first changed a file, and how much of that this task added. The
second number is the one a shorter document should move.

**The baseline, taken 2026-09-20 over the 16 recorded sessions**, all of
them before the cuts could affect a session: 30 tasks, **added a median of
5,032 tokens** and a mean of 11,102 before the first edit; carried a median
of 267,382. Re-run it after a week of ordinary work and compare the median
added. A drop is the evidence the cuts worked; no change means the cuts
were correct housekeeping and nothing more, which is worth knowing too.

## Acceptance

- [x] `node scripts/context-cost.mjs` prints the two numbers over the last
      sessions, with `--sessions=`, `--since=`, `--files` and `--json`.
- [x] It finds the transcripts whether it is run from the repository or from
      the folder above it, where both checkouts sit.
- [x] It prints counts and paths, never message text, and writes nothing.
- [x] It says what it cannot see: an edit or a read made through Bash.
- [x] The baseline above is recorded.
- [ ] Re-run after a week of ordinary work and put the numbers in this Log.

## Notes

- A task is one typed prompt through to the first Edit or Write. A prompt
  answered without an edit is a question and is left out.
- Lint covers it; there is no test. It reads a private log whose shape is
  the harness's, and a fixture of that shape would be evidence about our
  parser and none about the format — `docs/testing.md`'s own rule. The
  honest test is running it.

## Log

- 2026-09-20T02:30+08:00 — Written and built after the owner asked for the cuts to be measured
  rather than guessed.
