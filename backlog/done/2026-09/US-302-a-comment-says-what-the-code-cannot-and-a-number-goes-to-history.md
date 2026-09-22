---
id: US-302
issue: 57
title: A comment says what the code cannot, and a number goes to history
type: chore
priority: p2
created: 2026-09-22T16:34+08:00
parent:
area: architecture
resolution: shipped
---

## Context

Measured on 2026-09-22: 29,565 of 120,986 source lines are comments, one
in four. 2,107 lines name a ticket id. The docblock at the top of
`apps/api/src/leads.ts` is 32 lines and records that one instance's Reddit
gave 720 matches at an average of 48 and TikTok gave 47 at 61.

Those numbers are true and they are history. In the code they are a
session's memory, kept where the next reader has to read a story before
the signature. A contributor without the backlog cannot follow `US-267`,
and a contributor with it finds the same paragraph twice. This is what an
agent's working notes look like when they are committed as comments, and
it is repository-wide. US-258 names the four densest files; this ticket is
the rule, and the sweep that follows from it.

The rule is short. A comment says what the code cannot: the constraint,
the trap, the decision that would otherwise be made again. A measurement
goes to docs/history.md, which owns measurements. A ticket id may stay
when it is the only pointer to a decision, and then it is one id at the
end of one sentence, not a heading.

## Acceptance

- [x] AGENTS.md's rules section holds the comment rule in the words above,
      with the three things a comment is for and the two things it is not
      (a measurement, a narrative of how the code came to be).
- [x] A script, `scripts/comment-density.mjs`, prints per file the comment
      share and the count of lines that name a ticket id, sorted, so the
      sweep has a list and a later run has a comparison.
- [ ] Every comment block over 15 lines outside tests has been read and
      either cut to the rule or kept with a reason in this ticket's Log.
      The measurements moved go to history.md under the ticket that made
      them. **Split out**: 258 blocks in six areas is not one sitting, so
      this is US-258, US-303, US-304 and US-305.
- [ ] After the sweep the script is run again and both numbers are recorded
      here beside the ones above. **Each child records its own area**; this
      ticket records the whole repository when the last one closes.
- [x] US-258 is closed as `duplicate` of this ticket, or this ticket's
      sweep skips its four files and US-258 does them. The Log says which:
      US-258 keeps its four files, and the children leave them alone.
- [x] No behaviour changes. The diff is comments and history.md; the test
      suite is the proof.

## Notes

- The measurement one-liner:
  `find apps packages scripts \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) | grep -v node_modules | grep -v dist | xargs grep -hE '^\s*(//|\*|/\*)' | wc -l`
- Do the sweep in several commits, one per package, so a reviewer can read
  one.
- Docblocks that explain a wire format, a provider's undocumented behaviour
  or a money rule are the comments the rule protects. Cut the story, keep
  the trap.

## Log

- 2026-09-22T16:34+08:00 — Written after a review of the source against what a contributor reads, with the numbers above as the baseline.
- 2026-09-22T20:10+08:00 — The rule is in AGENTS.md and `scripts/comment-density.mjs` is written. It reports per file the comment share and the lines naming a ticket, with `--all`, `--json` for comparing two runs, and `--blocks --min=N` for the list a sweep works from. It counts a line, not a token, and ignores a trailing comment after code — which understates the share, and is the honest direction to be wrong in.
- 2026-09-22T20:10+08:00 — **The baseline, 2026-09-22**: 383 files, **28,990 comment lines of 118,597 — 24.4%** — **1,722 lines naming a ticket**, and **287 blocks over 15 lines**, of which 258 are outside tests. By area: engine 106, pipeline 98, apps/api 31, apps/web 12, packages/ui 9, evals 2. The densest file is `packages/pipeline/src/worker/collect.ts` at 507 comment lines of 1,140; the densest share is `packages/engine/src/sources/types.ts` at 76%.
- 2026-09-22T20:10+08:00 — The sweep is split. 258 blocks is a judgment per block and does not fit one session, which is backlog/README.md's own rule 8. US-303 takes `packages/engine`, US-304 `packages/pipeline`, US-305 `apps/` and `packages/ui`. US-258 keeps the four files it already named and stays a child of US-247, where it came from; the three new tickets say which files are its and leave them alone. Do US-258 first: it is the densest, and the judgment it settles is the one the others copy.
- 2026-09-22T20:10+08:00 — This ticket closes on the rule and the measurement, not on the sweep. Re-open nothing: when the last child closes, put the whole-repository numbers here beside the baseline, and the difference is the answer to whether the rule was worth writing.
- 2026-09-22T21:10+08:00 — **The sweep was tested and the premise failed.** US-258 read four files of three different kinds — an interface, a worker step, a provider connector and ten schema files — and cut 28 comment lines from 1,406. The schema files gave up nothing. The whole repository moved from 28,990 comment lines of 118,597 to 28,962 of 118,570, which is 24.4% either way. US-303, US-304 and US-305 are parked on that evidence rather than run.
- 2026-09-22T21:10+08:00 — So the 24.4% is not what this ticket assumed it was. It is a repository that documents its contracts densely, and the rule in AGENTS.md protects most of what is there. The rule is still right and still worth having — it is what a new comment is written against, and it is what caught the one real fault US-258 found: a comment claiming a question was open when docs/history.md recorded it as measured. It is not a reason to sweep 258 blocks.
- 2026-09-22T21:10+08:00 — The narrower rule that did pay: a measurement in the code that already sits in docs/history.md is a duplicate, and one copy will drift. `apify/linkedin.ts` held such a paragraph word for word. Counting how many more exist is a smaller ticket than any of the three parked ones, and is written in their Context.
