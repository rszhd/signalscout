---
id: US-309
title: One command says what the verdicts mean
type: chore
priority: p1
created: 2026-09-22T20:10+08:00
parent: US-033
area: tooling
resolution: shipped
---

## Context

US-033 asks one question — **does a higher score mean a better lead?** — and
it has stalled twice. Its own Log says why both times: the owner did not have
a clear hour. But the hour was never the whole cost. After reading the
conversations, somebody still had to invent SQL, decide what statistic is
honest at this sample size, and assemble the table, the per-platform split and
the boundary the acceptance asks for. That second half has no owner and no
method, so the first half never starts.

This ticket removes the second half. The judging stays a person reading a
conversation and pressing one of two buttons, which is what US-012 built and
what cannot be delegated.

## Acceptance

- [x] `pnpm verdicts` reads the database and prints: how many verdicts and how
      many matches are still unjudged; whether a higher score means a better
      lead, with the number; where good and not-relevant stop separating; the
      split per platform and per post-or-reply; and the full score against
      verdict list.
- [x] It spends nothing. No provider call, no model call.
- [x] It says "cannot say" rather than inventing an answer when the sample
      holds only one verdict, or only one kind of verdict.
- [x] `--sample=N` prints which matches to judge next, spread across score
      bands and platforms rather than taken from the top.
- [x] `--json` prints the same for comparing two runs.
- [x] The statistic is rank-based and its p-value is exact, not a normal
      approximation.

## Notes

- The two useful commands: `pnpm verdicts --sample=40` before the hour, and
  `pnpm verdicts` after it.
- It reads `feedback` where `superseded_at IS NULL`, so a changed verdict
  counts once, as the answer in force.

## Log

- 2026-09-22T20:10+08:00 — Built. The statistic is Mann-Whitney: the probability that a good lead outscores a not-relevant one when both are drawn at random, which is the ticket's question stated as one number. Its p-value is computed exactly by enumerating the distribution of U, because at tens of verdicts a normal approximation is not honest. A mean would be moved by one outlier, and a t-test would assume a shape nobody has checked.
- 2026-09-22T20:10+08:00 — `--sample` spreads across score bands and platforms rather than down the ranking, because the boundary is not at the top. Judging the forty highest-scoring matches would say almost nothing about where good and not-relevant stop separating, which is one of US-033's questions.
- 2026-09-22T20:10+08:00 — Run against the development database: 8 verdicts, 763 unjudged. It correctly refuses to answer, because all 8 are `good` and there is nothing to separate. That refusal is the behaviour worth having; a script that produced a boundary from one-sided data would be worse than none.
- 2026-09-22T20:10+08:00 — **Two things in US-033 are stale and it should be re-read before it is worked.** It says 40 matches are unjudged; there are 763. And it describes five verdicts — good at 71 and 59, not relevant at 53, 52 and 50 — which are not in this database: `feedback` holds 8 rows, all `good`, all Reddit posts, none superseded. Where those five went is unknown; they may have been on another instance. The ticket's argument does not depend on them, but its numbers do.
