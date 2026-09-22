---
id: US-233
issue: 50
title: A dry run estimates the pair it is about to call
type: bug
priority: p2
created: 2026-09-19T16:45+08:00
parent:
area: ai
resolution:
---

## Context

**`live:triage-score --dry` estimates the wrong models.** The figure is two
constants:

    `Estimated: about $${(((273 + 415) * rows.length) / 1_000_000)} at the
     prices measured on 2026-09-18.`

273 micro-dollars for a triage call and 415 for a classification, measured once
against `gpt-5.6-luna` on both stages. The instrument exists to try *other*
pairs — `--model=` and `--triage-model=` are its whole point — and the estimate
ignores both flags.

**Three runs on 2026-09-19 show the size of it:**

| run | estimate | actual | |
|---|---|---|---|
| 117 items, luna → sol | $0.0805 | $0.3128 | 3.9× low |
| 231 items, luna → sol | $0.1589 | $0.9719 | 6.1× low |
| 183 items, jev → deepseek-flash | $0.1259 | $0.1072 | 0.9×, slightly high |

**The constants are token counts wearing a price.** 415 is 1,500 input tokens
at luna's $0.20 per million plus 95 output at $1.20; 273 is about 1,000 input
and 80 output on the same model. The token shapes are a real measurement and
worth keeping. The prices baked into them are not: `modelPrices` already holds
every priced model and `estimateCostMicros` already applies it.

**This matters more than a wrong number on a screen.** `docs/instruments.md`
says to read it before running anything that spends, and the rule is that a
paid run is deliberate. An estimate six times under turns a deliberate $0.16
into an accidental $0.97, and the person who decided to spend never agreed to
that. It is also the one figure that decides whether a bigger `--per-cell` is
affordable.

## Acceptance

- [x] The estimate is computed from the configured triage and classifier
      models, so `--model=` and `--triage-model=` change it
- [x] A model `modelPrices` does not carry produces "cost unknown for <model>"
      rather than a figure, the same way a call records no cost rather than a
      guessed one
- [x] The token counts stay as named constants with the date they were
      measured, because they are a measurement and the prices were not
- [x] The three runs above are recorded in the Log with what the fixed
      estimator would have said for each

## Notes

- `estimateCostMicros` is already exported from the engine and already used by
  this file's own reporting, which is why the run's final line has always been
  right while the estimate was wrong.
- The estimate cannot be exact: token counts vary with the post and the
  monitor, and a reasoning model bills its own thinking as output. Close enough
  to decide with is the bar, not accuracy.
- `capture:scores` carries the same shape of claim in its header comment —
  "about 250 micro-dollars each and `gpt-5.6-terra` about 2800" — but those are
  prose in a comment naming their models, not a number computed for a pair the
  reader chose. Worth a glance, not necessarily a change.

## Log

- 2026-09-19T16:45+08:00 — Written after three runs in one day came in 3.9×,
  6.1× and 0.9× against their estimates. The 0.9× is the tell: the constants
  are not simply stale, they are right for exactly one pair of models and wrong
  for every other.

- 2026-09-19T17:00+08:00 — Fixed, and the fix is honest rather than accurate.
  The estimate now reads `modelPrices` for the two configured models, so the
  flags move it:

  | pair | estimate now |
  |---|---|
  | `jev-latest` → `gpt-5.6-terra` | $0.765 — 42 + 4,140 an item |
  | `gpt-5.6-luna` → `gpt-5.6-sol` | $1.893 — 296 + 7,900 an item |

  The old constant said $0.126 for both, because it said $0.126 for everything.

  **It now reads high rather than low, and the Notes say why.** Two things it
  cannot know before it runs. A score already bought under the same prompt is
  reused for nothing, and this prints before the cache is opened — the 231-item
  run reused 87 of its scores. And the token counts are one measurement on one
  pair; a reasoning model bills its thinking as output and exceeds them. High
  is the safer direction for a figure whose job is to let somebody decide
  whether to spend, so this is left as it is and said out loud in the comment.

  **Two things found while testing it, neither in scope here.**

  `--triage-model=` moves the model and not the provider, so
  `--triage-model=gpt-5.6-luna` against a `typesafe` environment prints
  `Triage: typesafe/gpt-5.6-luna` — a pair no provider can run. It survives a
  `--dry` because nothing is called, and would fail on the first real item.
  `capture-scores.ts` has both flags; this file has one. Worth its own ticket
  now that a triage-only provider exists.

  And the instrument runs sequentially: 183 items took about 25 minutes where
  `evals/triage` does 227 in 17 seconds at a concurrency of 12. Nothing about
  the measurement requires one at a time.
