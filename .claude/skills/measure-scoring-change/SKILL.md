---
name: measure-scoring-change
description: Measure a change that can move a score before it ships — the triage prompt, the classifier prompt, the pre-filter, a threshold, or a model. Use before closing any ticket that changes what reaches an inbox.
---

# Measure a scoring change

The loop from `docs/instruments.md`, *A change that can move a score is
measured before it ships*.

1. `pnpm --filter @signalscout/engine capture:triage --model=<triage model>`
   then `capture:scores --model=<classifier> --triage-model=<triage>`.
   About three cents. Read whether the leads survived before anything else:
   a drop at or above the threshold is a lead nobody will see.
2. `pnpm --filter @signalscout/engine capture:compare` prints one table over
   every model captured, calling nothing.
3. If that looks right:
   `pnpm --filter @signalscout/pipeline live:triage-score --dry` for the
   estimate, then without `--dry`. About fifteen cents. It writes nothing,
   so its spend shows on no screen.
4. Tighten or loosen, and go round again.
5. `ai/triage-scores.test.ts` is red whenever the classifier prompt moved.
   Do not edit the assertion; re-run step 1 and commit the new fixtures.
6. Promotion is the last step: change the pair in `ai/fixtures/pinned.ts`
   only when the matching capture exists.
7. The ticket's Log gets both halves: kept and dropped counts, and what the
   drops scored. Then the history paragraph, if a number moved.
