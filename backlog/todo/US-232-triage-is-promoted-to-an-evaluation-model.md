---
id: US-232
title: Triage is promoted to an evaluation model
type: feature
priority: p2
created: 2026-09-19T16:25+08:00
parent: US-229
area: ai
resolution:
---

## Context

**US-229 ended in a go.** `jev-latest` on the `typesafe` provider matches or
beats `gpt-5.6-luna` on every measurement taken, for a seventh of the cost, and
US-230 already shipped the option. This ticket is the last step US-229's own
Notes describe: *capture the new model, read whether the leads survived, put
the numbers in a ticket, change the environment, and only then change*
`pinned.ts`. The first three are done.

**A promotion is three moves and they are not interchangeable.** `pinned.ts`
names the pair the tests read, so changing it turns the suite red until the
matching fixtures exist — and they do:
`triage-verdicts-jev-latest.json` and
`triage-scores-gpt-5.6-sol-by-jev-latest.json` were captured on 2026-09-19.
The environment is what actually runs the model, and a self-hosted instance
sets its own. And the cloud runs the packages from npm, so nothing reaches the
hosted product until a release.

**The floor travels with the model.** Two of the six leads in US-229's sample
answer `no` on all five runs and survive only because a `no` under 0.6
confidence keeps. Promoting the model while treating the floor as tunable would
catch four of six. `defaultTriageConfidenceFloor` is part of the pair, not a
setting beside it.

**The product now holds two ideas of a lead, and a reader should be able to
find that out.** `triage-prompt.ts`'s system prompt asks US-221's tightened
question — could this author be a person to reach, *and* does anything say they
want an answer. `triageEvaluationInstructions` in the same file asks the older
one. Both are deliberate and both are measured; neither file says the other
exists in the place a reader would look first.

## Acceptance

- [ ] `pinnedTriageModel` is `jev-latest`, and `pnpm test` passes on the
      fixtures already captured
- [ ] `docs/history.md` carries US-229's five readings and the date, so the
      number behind the choice outlives this ticket
- [ ] AGENTS.md's *Where the product stands* says triage runs on an evaluation
      model, in one sentence, and deletes nothing it replaces
- [ ] `.env.example` and `.env.example.self-hosted` name the pair a new
      instance should start from, with the key it needs
- [ ] `triage-prompt.ts` says, where a reader meets either prompt, that the
      other exists and asks a different question
- [ ] A release is cut, and the cloud leaves `packages-from-source.mjs` behind
      for the published version
- [ ] `recommended.ts` is considered and either changed or explicitly left
      alone, with the reason: a triage-only provider has no classifier to pair
      with, and `recommended.test.ts` asserts a price gap for every provider in
      that table

## Notes

- The suite goes red between changing `pinned.ts` and nothing else, because the
  fixtures exist. Verify rather than assume: `pnpm test` is the check.
- `AI_TRIAGE=off` is `on` in the cloud's environment for the trial, and US-178
  set it off for a reason that no longer holds. The comment beside it carries
  the original reasoning.
- A self-hosted instance that does nothing keeps `gpt-5.6-luna`, because the
  environment decides and only the recommendation moves. That is the intended
  shape: **every default is the self-hosted answer**, and a self-hoster with no
  TypeSafe key must not wake up to a stage that cannot run.
- Jev cannot classify, draft or embed. `recommended.ts` pairs a triage model
  with a classifier per provider, and there is no `typesafe` classifier to pair
  with. This is the first provider of that shape and the table was not built
  for it.
- The live trial is still running. If it refuses a lead the owner would have
  wanted, this ticket stops.

## Log

- 2026-09-19T16:25+08:00 — Written as US-229 closed. The spike's go is in its
  Log with the five readings behind it, and the three things that go rests on.
