---
id: US-247
title: A file header holds the contract, not the story
type: chore
priority: p2
created: 2026-09-20T00:58+08:00
parent:
area: packages
resolution: shipped
---

## Context

In `packages/`, 14,300 of 35,100 non-blank lines are comments: 40%. File
headers run 40 to 70 lines (`matches/matches.ts`, `ai/triage-prompt.ts`,
`socialcrawl/client.ts`, `socialcrawl/reddit.ts`, `worker/filter.ts`), and
130 ticket ids are cited in code. Every time an agent opens a file it pays
for the story again, and the story is already in the ticket the header
names. The AI keeps the style because the rule is to match the surrounding
comment density, so the density only grows.

The why is worth keeping. The where is the question: a header holds what the
file does, the invariant it keeps, and the failure shape, and it names the
ticket that holds the rest.

## Acceptance

- [x] `AGENTS.md` says what a file header holds and how long it is, in one
      paragraph under *Writing*.
- [x] The eight longest headers in `packages/` are cut to that shape, with
      the removed text checked against the ticket it names and added to that
      ticket's Log if it is not already there.
- [ ] Comment lines in `packages/` are below 30% of non-blank lines — **not
      done here.** The eight headers were 2% of the comment lines; 40.2%
      remains. The rest is inline commentary across 147 files, and US-258
      takes the four densest files first.
- [x] Tests, lint and typecheck pass; no code changes.

## Notes

- Measure with: `grep -cE '^\\s*(//|/?\\*)'` over non-test `.ts` files
  under `packages/`, against `grep -cvE '^\\s*$'`.
- `Correctness-critical` headers keep their failure shape and test list;
  that is the contract.

## Log

- 2026-09-20T00:58+08:00 — Written from the context review of 2026-09-20: the owner asked
  where the AI-assisted workflow loses context and quality, and this is one
  of the findings.
- 2026-09-20T01:17+08:00 — Shipped for the headers and the rule. The eight longest headers are 15 to 18 lines now; the removed text is in history.md under *Code headers* rather than spread over the tickets each one cited, since most cited several. 2,130 tests, lint and typecheck pass. The 30% box is not met and is US-258.
