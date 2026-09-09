---
id: US-087
title: A model key is tested before it is stored
type: feature
priority: p2
created: 2026-09-09T13:40+08:00
parent: US-079
area: api
resolution: done
---

## Context

**A provider key is tested before it is stored and a model key is not.** The
connections screen calls `validateCredentials`, and a key the provider refuses
writes no row — US-023 proved that live, and docs/secrets.md says why. The
Models screen stores whatever is pasted. A wrong model key is therefore
discovered by the worker, hours later, as a poll that scores nothing.

US-068 recorded the reason for the difference: no model provider here publishes
a free probe, so testing on save spends somebody's money on a call they did not
ask for. US-080 answered that with a button on each job card — the person
presses it, so the person asked for it.

**The owner has decided the other way.** A key added on this screen is tested
before it is stored, the same rule as a provider key. The cost is the reason
this was refused twice, so it is stated rather than hidden: one small
structured call per key added, priced like any other call and recorded in the
ledger. The dialog says so above the button.

**A test needs a model, and a key names none.** So the dialog asks for one,
prefilled with this build's recommendation for the chosen provider — the same
model the key will run when it becomes the account default. It is not stored.
Without the field a key for OpenRouter or Ollama could not be tested at all,
because `recommendedModelFor` answers null for both by design.

## Acceptance

- [x] Adding a key on the Models screen probes the provider before the row is
      written
- [x] A key the provider refuses is not stored, and the provider's own sentence
      is shown
- [x] The dialog stays open on a refusal, with the typed values intact
- [x] The probe uses a model the person can see and change, prefilled per
      provider
- [x] The billed call is recorded in the ledger under `key_test`
- [x] An instance with no `ENCRYPTION_KEY`, and a name already taken, are
      refused before anything is spent
- [x] No test in the suite reaches a provider
- [x] Provider keys are re-checked and still tested before storing

## Notes

- The order of refusals is money: no encryption key, then a duplicate name,
  then the probe. Both of the first two would throw the paid call away.
- `answered` stores the key. The provider accepted it and billed for it, which
  is the whole question being asked here — the doubtful half is the test model,
  and no model is stored on a key row.
- **The probe cannot tell a refusal from an unreachable provider.**
  `generateStructured` answers one `failed` for both, where `connections.ts`
  separates them into 400 and 502. So a provider outage blocks a good key from
  being stored, and the person is shown the provider's own sentence and can
  retry. Separating the two is a change to `call.ts`, not to this route.

## Log

- 2026-09-09T14:05+08:00 — Built. Twelve new cases — eight on the route, four on
  the screen — and 1,609 tests pass, lint and typecheck clean. Two mutations
  were confirmed to turn the suite red: dropping the probe from the add route
  fails four cases, and storing a refused key fails one.

  **The provider half needed nothing.** `PUT /api/connections/:provider` has
  probed before writing since US-023 and still does, with the refusal at 400
  and the unreachable provider at 502. Only the model half changed.

  **Nothing has been tested against a real provider.** The probe is injected,
  so the whole path is proven against a fake, which is evidence about our half
  and none about a provider's. The first real press is worth reading: what a
  wrong key answers, and whether the sentence carried out is one a person can
  act on.
