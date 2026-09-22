---
id: US-302
issue: 57
title: A comment says what the code cannot, and a number goes to history
type: chore
priority: p2
created: 2026-09-22T16:34+08:00
parent:
area: architecture
resolution:
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

- [ ] AGENTS.md's rules section holds the comment rule in the words above,
      with the three things a comment is for and the two things it is not
      (a measurement, a narrative of how the code came to be).
- [ ] A script, `scripts/comment-density.mjs`, prints per file the comment
      share and the count of lines that name a ticket id, sorted, so the
      sweep has a list and a later run has a comparison.
- [ ] Every comment block over 15 lines outside tests has been read and
      either cut to the rule or kept with a reason in this ticket's Log.
      The measurements moved go to history.md under the ticket that made
      them.
- [ ] After the sweep the script is run again and both numbers are recorded
      here beside the ones above.
- [ ] US-258 is closed as `duplicate` of this ticket, or this ticket's
      sweep skips its four files and US-258 does them. The Log says which.
- [ ] No behaviour changes. The diff is comments and history.md; the test
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
