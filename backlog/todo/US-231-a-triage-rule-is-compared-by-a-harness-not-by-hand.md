---
id: US-231
issue: 48
title: A triage rule is compared by a harness, not by hand
type: chore
priority: p2
created: 2026-09-19T14:10+08:00
parent: US-229
area: ai
resolution:
---

## Context

**Four comparisons of triage rules were run on 2026-09-19 and three of them
carried an error nobody could see.** Each one produced a table that looked
right, and each error was in the harness rather than in a model:

1. The dataset was built from `live:triage-score`'s run record, whose
   `excerpt` field is `row.excerpt.slice(0, 300)`. The triage call it recorded
   got the whole post. So one rule was judged on a third of the text the other
   saw. Every count still added up.
2. The confidence floor was written into the analysis as *drop a keep below the
   threshold*, where `triage.ts` does the opposite: *keep a drop below it*. The
   comparison reported 12 items forwarded where the code forwards 33.
3. The harness kept its own copy of the rule rather than calling the engine's,
   so it measured a wording that was never shipped.
4. Totals were derived in prose: a triage spend was called a saving, and a
   conclusion that Jev cost more than `gpt-5.6-luna` survived until the
   arithmetic was written down, where it turned out to be 43% cheaper.

**None of those is a model problem and none was caught by reading.** They were
caught by writing the same thing a second way and finding it disagreed.

**So this ticket is the harness.** `evals/triage/` runs promptfoo over a
`live:triage-score` sample, with one rule per provider file, and it is built so
that each of the four above fails loudly instead of scoring:

- `build-dataset.mjs` reads post text from the database and **refuses to
  write** if any item is shorter there than in the record, is missing a post or
  a monitor, or is empty.
- Providers answer `keep` or `drop` — the decision the stage makes, not the
  verdict behind it, because naming the output after the verdict is what let
  the floor be stated backwards.
- `providers/shipped.mjs` imports `createTriager`. It cannot drift from the
  product, because it is the product.
- `summarise.mjs` computes precision, recall and the classifier bill from
  promptfoo's own numbers, in a file that can be reviewed and re-run.

**It is an instrument, not a test.** It spends money and `pnpm test` does not
touch it, the same rule `docs/instruments.md` sets for every `capture:`.

## Acceptance

- [ ] `pnpm eval:dataset <run record>` refuses on truncated, orphaned or empty
      items, and says which
- [ ] `pnpm eval:triage` runs every provider over the same dataset, and
      `pnpm eval:summary` prints leads, matches, forwarded, waste, precision,
      recall and cost per rule
- [ ] The shipped provider calls the engine's `createTriager`, so a rule change
      in `triage-prompt.ts` moves the number without editing the harness
- [ ] A metric only counts the items it applies to: a post that is not a lead
      does not pass `leadsKept`
- [ ] `docs/instruments.md` carries the harness, what it costs and when to run
      it
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, and `pnpm test` runs
      none of it

## Notes

- Costs about $0.03 for three rules over 227 items, and takes about 17 seconds.
  The dataset build and the summary spend nothing.
- `promptfoo eval` exits 100 when any assertion fails. On an eval that is the
  normal outcome, not an error, so do not read the exit code as a failure.
- **A variable that is an array is expanded into one test case per value.**
  `signals` did that silently and ran every item six times, turning 681 cases
  into 3,792 and every count with it. It is joined into a string for that
  reason.
- A `weight: 0` assertion contributes zero to its metric, so counters written
  that way made every total zero and `precision` print as 12. promptfoo already
  reports a denominator — a metric arrives as a score over the number of cases
  that carried it — so no counters are needed.
- `evals/*/dataset.json` is not committed. It holds real people's post text and
  is rebuilt in seconds.
- `pnpm check:licenses` fails on `lightningcss` (MPL-2.0) and did so before
  this work. Unrelated, and still worth someone's decision.

## Log

- 2026-09-19T14:10+08:00 — Written after the harness was built and run. The
  trigger was the owner saying they cannot afford mistakes in the script,
  because the script is what makes the judgement. That is the right reading:
  every wrong number on 2026-09-19 came from the measuring, not the measured.

  The rebuild found one more the same day. The shipped rule forwards 33 items
  of 227, not the 52 reported earlier, because the earlier harness measured its
  own copy of the wording rather than `triage-prompt.ts`. That is the fourth
  error of the four this ticket exists to prevent, caught by the thing built to
  prevent it.
