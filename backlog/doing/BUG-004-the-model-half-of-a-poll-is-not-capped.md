---
id: BUG-004
title: The model half of a poll is not capped
type: bug
priority: p1
created: 2026-09-06T04:42+08:00
parent:
area:
resolution:
---

## Context

US-013's guard refuses work before it is bought. Three steps consult it —
`collect`, `replies` and `estimate` — and two do not: `filter` and `classify`.
So a monitor's provider spend is bounded and its **model spend is not**.

The spend is *counted* correctly. `readSpend` sums `model_calls` without asking
what each call was for, so every triage and every classification lands against
the cap and the next poll sees it. What is missing is the refusal: once a batch
of posts is in the filter step, nothing between there and the last
classification asks whether there is any money left.

**US-020 turned a small overshoot into a large one.** AGENTS.md already records
that a cap can be overshot by one poll, because the guard runs before a poll and
cannot know what the poll will cost. That was bounded by `maxPagesPerPoll`: a
poll collected about fifty posts and so bought about fifty classifications.

With replies on, one poll of 23 posts produced **328 replies**, and those
replies bought **328 triage calls and 123 classifications** with no cap
consulted between any of them. Measured on 2026-09-06 during US-020's live run:
$0.047 of provider spend and roughly $0.52 of model spend, against a $0.60 cap
that was never asked.

It landed under the cap by luck. A busier subreddit, a longer thread, or a
dearer classifier would have walked past it without a single refusal, at 02:00,
which is the exact sentence `docs/testing.md` uses for this surface.

**Why the two steps were written without it, and why that reasoning has
expired.** The guard's job is to refuse before money is spent, and the poll is
where money was spent — the model half was the small half and it was bounded by
how many posts a poll could collect. Neither is true now. A reply costs a model
call and nothing else, so the model half is the whole bill on a monitor that
reads replies.

**What must not be broken by the fix.** A refusal in the middle of a batch
leaves posts collected, billed, and unclassified. They must stay retryable
rather than be silently dropped, and the reason must reach a person: an inbox
that goes quiet because a cap was reached looks exactly like a quiet week, which
is the failure this repository keeps writing down.

## Acceptance

- [x] The classify step refuses to start a batch when the monitor is at its cap,
      and says so in one sentence a person can act on
- [x] It also stops part-way through a batch, because a batch of 123 items can
      cross the cap between its first item and its last
- [x] The filter step does the same for triage, which is a model call and is
      billed like one
- [x] A post left unclassified by a refusal keeps its place and is picked up by
      a later poll once there is room, and a test proves it is not dropped
- [ ] The monitor screen says the monitor stopped for money rather than for
      lack of matches — **not done: the reason reaches the log and not yet a
      screen**
- [x] A test drives a monitor over its cap through the reply path specifically,
      because that is the path that made this large
- [ ] The Log records what one capped poll costs against what an uncapped one
      does, measured rather than argued — **not done: needs a live run, and the
      one that found this bug has already been paid for**

## Notes

- Found on 2026-09-06 by US-020's live run, not by the suite. The suite proves
  the guard refuses a poll; nothing asked whether anything refuses a
  classification.
- The budget guard is on docs/testing.md's correctness-critical list, and its
  named failure shape is "money spent past a cap, silently, at 02:00". This is
  that shape.
- `enforceBudget` already pauses the monitor when the behaviour is `pause`, so
  the refusal has somewhere to go. Read `budget/budget.ts` before adding a
  fourth caller.
- Checking the cap once per item is a query per item. Read it once per batch and
  again every N items, or track spend in the loop and re-read on a threshold —
  the loop already knows what each call cost.
- Do not fix this by shrinking the batch. A smaller batch crosses the cap in the
  same place and hides the problem behind a smaller number.

## Log

- 2026-09-06T04:42+08:00 — Written during US-020's live run, when the owner
  guessed the run had stopped for budget. It had not — nothing stops for budget
  there, which is the bug. The guess was right about the shape and wrong about
  the behaviour, and checking which turned a hunch into this ticket.

- 2026-09-06T04:55+08:00 — Fixed, in the two steps that were missing it.
  `createSpendMeter` reads the ledger once, subtracts what the loop reports as
  it spends, and re-reads every twenty calls so a second worker on the same
  monitor is noticed rather than assumed away. A monitor with no cap never
  re-reads, so an uncapped deployment pays one query for a whole batch.

  **The two steps stop differently, and the difference is deliberate.** Classify
  refuses: it is where the money actually goes, and a post it does not reach is
  left with no `model_calls` row and no match — indistinguishable from a post
  the model was never shown, which is what makes a later poll pick it up. Triage
  stops *calling* but keeps every item it did not ask about, because running out
  of budget is not a `no` and the rule that stage is built on is that only an
  explicit `no` drops. Passing them on costs nothing, since classify then
  refuses the spend that matters.

  Stopping at a cap does not throw. A dead-lettered job would turn a correct
  refusal into an alarm and then retry it four more times against the same empty
  budget.

  Five cases in `classify.test.ts` hold it, and the one that matters most is the
  last: a post the cap stopped is classified normally once a person raises the
  cap. That is the difference between stopping and losing. 944 tests pass.

  Two boxes stay open and neither is code in this step. The reason reaches the
  log and not yet a screen, and the measured comparison needs another live run —
  the one that found this bug cost $0.715 and there is nothing to learn from
  repeating it at this hour.
