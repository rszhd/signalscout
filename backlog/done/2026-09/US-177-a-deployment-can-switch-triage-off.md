---
id: US-177
title: A deployment can switch triage off
type: chore
priority: p2
created: 2026-09-18T01:30+08:00
parent: US-030
area: ai
resolution: shipped
---

## Context

US-030 built the triage stage on one idea: a cheap model reads everything, so
the dear model reads less. It measured the idea and found half of it false —
**a one-word answer is not a cheap answer.** A reasoning model bills its own
thinking as output, so a triage answer came to 113 output tokens against a
classification's 95, and cost slightly more per call than the call it avoids.

So the whole saving is the price gap between the two models. Over 46 real
comments: with a classifier ten times dearer, the bill fell 48%; with the same
model on both stages it rose 48%. The worker has warned about that since.

What was missing was a way to act on the warning. `AI_TRIAGE_MODEL` falls back
to `AI_MODEL`, so leaving it blank does not switch the stage off — it runs
triage on the classifier's own model, which is the most expensive arrangement
there is. The only way to have no triager was to have no classifier either.

The argument for switching it off is not only money. A cascade's bargain is
that a cheap reader's mistakes are bought back by a better one behind it. With
one model on both stages there is no better reader: triage asks a looser
question of the same judge, and what it drops leaves no row, no inbox entry and
nothing for a person to notice. Same model, no gap — the stage costs more and
keeps all of the risk.

The decisions this ticket makes rather than the code:

- **A new variable, not a sentinel.** `AI_TRIAGE=on|off`, defaulting to on.
  `AI_TRIAGE_MODEL=none` would have overloaded a name field, and the premise
  being changed — "the question is which model triages, never whether one
  does" — is worth its own line.
- **The config still answers "how".** `triageConfigFromEnvironment` is
  unchanged and `triageIsOff` is separate, so `capture:triage` still builds a
  triager on a deployment that has switched the stage off. A capture that
  measures triage must not be silenced by a deployment's choice.
- **Only the worker reads it.** The `live-*` scripts build triagers of their
  own on purpose: they are measuring instruments.
- **No new path downstream.** `worker/filter.ts` has always treated a missing
  triager as "nothing is dropped on triage", so this returns `undefined` into
  a branch that already existed and is already tested.

## Acceptance

- [x] `AI_TRIAGE=off` builds no triager, and the boot log says so.
- [x] Unset and `AI_TRIAGE=on` both triage, because unset is not off.
- [x] `triageConfigFromEnvironment` still returns the settings when the stage
      is off, so a capture can measure it.
- [x] `.env.example`, `.env.example.self-hosted` and `docs/costs.md` say that
      a blank model is not "no stage", and name `AI_TRIAGE=off`.
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

## Notes

- `packages/engine/src/ai/env.ts` (the field), `ai/config.ts` (`triageIsOff`,
  and `AI_TRIAGE` on `AiEnvironment`), `packages/pipeline/src/worker/runtime.ts`
  (the two build sites). No change to the filter step.
- The startup warning about two matching models stays. A deployment that runs
  the same model and leaves the stage on is still being told.
- Not done here: capping how long a triage model reasons. That would make the
  cascade pay again even on one model — roughly 28% under classifying
  everything, if the 113 tokens could be held near 30 — and it is the better
  fix where the stage's filtering is wanted. The engine exposes no reasoning
  effort today, and nobody has measured whether a model told to think less
  triages as safely.

## Log

- 2026-09-18T01:30+08:00 — Written and shipped in one pass, out of a costing
  conversation on the cloud side: the cloud is moving its classifier to the
  cheap model, which removes the price gap and makes the stage a pure loss
  there.
