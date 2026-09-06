---
id: US-033
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

