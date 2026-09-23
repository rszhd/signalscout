---
id: US-033
issue: 32
labels: [help wanted]
title: Thirty verdicts say whether the score is right
type: chore
priority: p1
created: 2026-09-06T03:02+08:00
parent:
area:
resolution:
---

## Context

PLAN.md's *Important rule* protects one thing: **the quality of the intent
detection is more important than the number of integrations.** Everything built
since 5 September has been capability — a third platform, a second Reddit
provider, a provider picker, a fourth pre-filter stage, a model swap. Each is
sound. None of them tells anybody whether this product finds leads a person
would act on.

**The last time a human judged a match was five verdicts, on one monitor, on
2026-09-05.** They were re-read on 2026-09-06 and they say more than the
earlier write-up claimed. AGENTS.md said the verdicts did not follow the
scores. They follow them exactly: good at 71 and 59, not relevant at 53, 52 and
50, so every kept post outscored every refused one.

What is thin is the margin — six points across the boundary, all five inside a
21-point band — and the sample. With two goods and three refusals a perfect
split happens by chance one time in ten. So the score is **supported and
untested**, not wrong, and the forty unjudged matches are what turn one into
the other.

One number is already actionable. **The boundary those five imply is near 56,
and `defaultMinimumScore` is 30.** All three refused posts cleared the default
and reached the inbox. US-022 reached the same conclusion by another route when
it measured that 30 was too low inside a topical subreddit.

**The evidence needed is already paid for.** The database holds 45 matches
across six monitors and all three platforms, and **40 of them have no verdict**:
20 from US-022's Reddit run, 10 and 4 from the two ScrapeCreators monitors, 5
from the live LinkedIn poll, 2 from the live X poll, 4 from the first monitor.
Judging them costs nothing and spends nothing. There is no poll to run.

**Forty-five verdicts is still not a distribution**, and this ticket must not be
written up as one. It is the difference between a number nobody has checked and
a number somebody has checked once, across three platforms rather than one.

**This is not the learning loop.** US-012 stores verdicts against the monitor
version that earned them and deliberately stops there, because a learning loop
with nothing to learn from is speculation. This ticket is what stops it being
speculation. Whether the verdicts then feed the classifier is a separate ticket
and is still not written.

## Acceptance

- [ ] Every one of the 40 unjudged matches has a verdict, given by a person
      reading it
- [ ] The Log holds a table of score against verdict, so the two can be
      compared at a glance
- [ ] The Log answers one question in a sentence: **does a higher score mean a
      better lead?** With the number that supports the answer
- [ ] The Log names the score at which good and not-relevant stop separating,
      or says they never separate
- [ ] `defaultMinimumScore` and each monitor's `min_score` are moved or
      explicitly kept, with the reason
- [ ] The verdicts are broken down per platform, because Reddit keyword,
      Reddit subreddit, X and LinkedIn produced different kinds of noise and a
      single rate would hide that
- [ ] AGENTS.md's claim that the score is "untested" is replaced with what the
      verdicts said

## Notes

- Costs nothing. No provider call, no model call. The matches exist.
- `pnpm dev` serves the inbox; US-011 built the screen and US-012 added the two
  buttons. Judging happens there, not in SQL.
- `exportFeedback` in `packages/core/src/feedback/feedback.ts` reads the
  verdicts back out with the match they judged. That is the query the Log's
  table comes from.
- A verdict is recorded against `monitors.version`. Do not edit any monitor's
  product, ideal customer, problem or signals while judging: that moves the
  version and splits the sample across two of them.
- US-022's own finding is the hypothesis to test. It said a `min_score` of 30
  is too low for a subreddit, because inside a topical subreddit every post is
  somewhat relevant and the scores compress upward, and that 50 left nine
  matches that were all real. Four of the six monitors here already sit at 50.
- The five existing verdicts stay in the sample. They were given against
  version 1 of their monitor and nothing has moved it.

## Log

- 2026-09-06T03:02+08:00 — Written. The trigger is a question about whether the
  plan is on track: the answer was that execution is fine and the direction has
  drifted from PLAN.md's own priority. Forty matches are already sitting
  unjudged, so the cheapest useful thing this project can do next is read them.

- 2026-09-06T03:08+08:00 — Re-read the five verdicts that already exist, before
  judging anything new, and corrected the record. They rank perfectly: 71 and 59
  kept, 53, 52 and 50 refused. AGENTS.md's claim that they do not follow the
  scores was wrong and is fixed. The real weakness is the margin and the sample
  size, not the ordering.

  The forty are still unjudged. The dev stack is serving the inbox, and nothing
  about this entry is a substitute for reading them.

- 2026-09-06T12:02+08:00 — Started and put back. The inbox was checked and the
  work is ready: all **47** unjudged matches are reachable on one screen,
  paused monitors included, across all four platforms. The owner has not got a
  clear hour to read them, which is the whole cost of this ticket and cannot be
  delegated.

  Two of the 47 are new tonight and worth judging first when the hour comes: a
  Reddit reply at 56 and a YouTube reply at 65. They are the first **replies**
  ever put in front of a person, and whether a comment under somebody else's
  post is a real lead is the premise US-020 and US-034 were both built on.

  Nothing about the ticket changed. It still costs no money and still blocks
  PLAN.md's first meaningful question.

- 2026-09-22T20:10+08:00 — US-309 built `pnpm verdicts`, so the half of this ticket that had no method now has one: judge in the inbox, then run one command for the table, the per-platform split, the boundary and the answer. The hour of reading is still the owner's and still the whole remaining cost.
- 2026-09-22T20:10+08:00 — **Two numbers here are out of date.** The database holds **763** unjudged matches, not 40 — it has grown since 6 September, and judging all of them is not an evening. `pnpm verdicts --sample=40` picks a spread across score bands and platforms, which is better evidence about the boundary than the top forty would be. And the five verdicts described above are not in `feedback`: it holds 8 rows, all `good`, all Reddit posts, none superseded. The reasoning above stands; the arithmetic needs redoing against what is actually stored.

- 2026-09-22T21:40+08:00 — **Twenty-six verdicts given, and the score works.** 14 good, 12 not relevant, all Reddit posts, all on this owner's account. A good lead outscores a not-relevant one **94.1% of the time** (Mann-Whitney, exact p = 5e-10). The sample is small and the effect is not: chance does not produce this.

  | Score | Verdict |
  |---:|---|
  | 77, 73, 66, 61, 54, 53, 52 | good |
  | 49 | good, and one not relevant |
  | 46, 46, 45 | good |
  | 44 | not relevant |
  | 43 | good |
  | 42, 40, 40 | not relevant |
  | 40 | good |
  | 38, 35, 34, 34, 31, 30, 30 | not relevant |

  **The boundary is 43, not 56.** This ticket's Context predicted near 56 from five verdicts that are no longer in the database; twenty-six say 43. Between **40 and 49** the score decides nothing — that is the overlap band. A cut at 43 loses one good lead and admits two not-relevant ones.

  **`defaultMinimumScore` of 30 is too low, and that is now measured.** Everything scored below 38 was not relevant, eight out of eight. US-022 reached the same conclusion by another route.

- 2026-09-22T21:40+08:00 — **Still open, and what is missing is the per-platform split.** All 26 verdicts are Reddit. This owner's account holds 283 unjudged matches and every one is Reddit; the X, YouTube, TikTok and LinkedIn matches in this database belong to test accounts, so they cannot be judged from here. So the honest claim today is *the score works on Reddit*, not *the score works*. Closing this ticket needs verdicts on the other platforms, which needs either monitors on those platforms under a judging account, or BUG-311 fixed so the tooling stops pointing at matches the reader cannot open.
