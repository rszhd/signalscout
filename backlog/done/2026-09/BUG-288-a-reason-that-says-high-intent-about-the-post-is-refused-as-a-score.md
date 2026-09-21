---
id: BUG-288
title: A reason that says "high-intent" about the post is refused as a score
type: bug
priority: p2
created: 2026-09-21T18:05+08:00
parent:
area: engine
resolution: fixed
---

## Context

Seen live on 2026-09-21, in the hosted product on a worktree of US-285: the
same post left unclassified on every batch, retried, and then dropped as
"the model failed on this post too many times". The worker log holds the
answer `deepseek-flash` gave, and it is a good one:

    "Author asks B2B founders how long it took them to land their first paying client."
    "They want a breakdown between high-intent conversations and legal/compliance contract timeline."
    "They ask whether the first deal came from connection, cold outreach, or organic community interaction."
    ...

`classification.ts` refuses it: `restatesTheScores` matches the second
reason. `valueBeforeName` is `\b(high|low|…)\b[^a-z0-9]{0,4}\b(intent|…)\b`,
and "high-intent conversations" is "high", a hyphen, "intent". The rule was
written for "high intent" as a verdict — a reason that spends a line saying
what the score beside it says. Here "high-intent" is an adjective on the
post's own words. The model cannot get past it: the post is about that
phrase, so every retry writes it again, and the retry budget is spent on a
refusal that was never the model's fault. On the batches measured, 1 to 2
posts of every 35 to 75 went this way, and on a product whose whole
vocabulary is "intent" the phrase is common. Any model can write it; DeepSeek
is only the one that was running.

**The shape of the check is the bug, not the pattern.** The owner decided on
2026-09-21. What the rule protects is one dull line on an inbox card. What a
false positive costs is the whole answer thrown away, the model paid again
to write the same true phrase, and the post dropped — a lead lost, silently,
after three paid calls. The two sides are not equal, so a rule that can only
ever cost a line must not be able to cost a post. Fixing the regex for
"high-intent" leaves the next phrase nobody thought of to do the same thing.

**So the check becomes soft.** `restatesTheScores` stays, and it stays a
refinement of nothing: the schema accepts the answer, and the classifier
drops the offending reasons from the list afterwards. If enough reasons
remain, the classification stands with those. If too few remain, it stands
with what is there, and the worker logs which reasons were dropped so the
rate can be read. No retry, no refusal, no dropped post; the line still never
reaches the card.

**The prompt says it too.** The instruction not to restate the scores stays
in the prompt, because a model told the rule writes fewer lines the filter
has to remove. The filter is the second reader, not the first.

## Acceptance

- [x] `classificationSchema` no longer refuses a reason for restating the
      scores; `restatesTheScores` is applied after parsing, in the
      classifier, and removes the reasons it matches.
- [x] The live answer above, as a fixture, classifies with every score and
      three reasons; nothing is retried and nothing is logged as a failure.
- [x] An answer whose reasons all restate the scores still classifies, with
      the reasons it has, and the worker logs one line naming the monitor,
      the post and the reasons removed.
- [x] `restatesTheScores("high intent")`, `("intent: high")` and
      `("Intent is 88")` are still true, and those reasons never reach the
      inbox; the existing cases in `classify.test.ts` and
      `classification.test.ts` move from "refused" to "removed" and are
      otherwise unchanged.
- [x] The prompt keeps its sentence about not restating the scores.
- [x] The comment on `restatesTheScores` says why it removes and does not
      refuse, so the next reader does not make it a gate again.

## Notes

- `packages/engine/src/ai/classification.ts` (`reason`, `restatesTheScores`),
  `packages/engine/src/ai/classify.ts` (where the answer is read),
  `classify-prompt.ts` (the sentence stays).
- The live answer is in the hosted product's worker log of 2026-09-21; the
  message is truncated there at 400 characters, so the match was read off
  the regex and the visible text rather than off the validator's own path.
  The fixture in the second box is what proves the reading.
- Why not prompt-only: the model still does it sometimes, and with no check
  nobody would know how often. Removing after the fact keeps the card clean
  and the count readable.

## Log

- 2026-09-21T19:40+08:00 — Fixed on `feature/us-287-pair-ceiling`, beside
  US-287. `withoutRestatedScores` removes after parsing; the schema's
  refinement is gone; the outcome carries `removedReasons` and the worker
  logs them. The live answer is a fixture in `classification.test.ts`. 46
  engine cases pass, the prompt's sentence is unchanged.

- 2026-09-21T18:05+08:00 — Written from the hosted product's first live
  poll under US-285, where it dropped one post in every batch.
- 2026-09-21T18:30+08:00 — Rewritten from "fix the pattern" to "make the
  check soft": the owner decided a rule that can only cost a line must not
  be able to cost a post.
