---
id: US-080
title: A model key is tested on the screen
type: feature
priority: p2
created: 2026-09-09T02:00+08:00
parent: US-079
area:
resolution: done
---

## Context

A provider key is tested before it is stored, and docs/secrets.md says why: a
key the provider refuses is never written, and the refusal names the provider's
own reason. A model key never was, and US-068 recorded the reason — no model
provider here publishes a free probe, so validating on save would spend
somebody's money on a call they did not ask for.

**Pressing a button is asking for it.** That is the whole difference. So the
test is a button on the job card rather than a step in saving, and it is
offered only when the job holds both halves it would test: a key and a model.

## Acceptance

- [x] A job with a chosen key and a model offers a Test button
- [x] A job missing either does not, and the route refuses before it spends
- [x] The test makes one small call with that job's provider, model and key
- [x] It tests what is on the screen, before anything is saved, and writes
      nothing
- [x] The provider's own sentence is shown when it fails
- [x] The call is recorded in the ledger, under its own purpose
- [x] No test in the suite reaches a provider

## Notes

- `ai/probe.ts` answers three states, not two. `ok` is the model answering;
  `answered` is the provider accepting the key and billing for it while the
  model returns the wrong shape — the key is fine and the model is the doubtful
  part, which sends a person somewhere different from a refusal.
- The probe uses the **structured** path, because that is the call this product
  makes. A model that answers prose where a schema was asked for scores nothing,
  and a test that passed on a plain completion would have said the setup worked.
- The purpose is `key_test`, and **migration 0051 is what makes the database
  accept it**. A value added to an array in `schema.ts` is not a value the
  database accepts, and this repository shipped that mistake in US-057 and again
  in US-040.
- The probe is injected into the routes, so the suite answers without a
  provider. No test here spends money.
- It tests **what is on the screen**, so the order is test and then keep.
  Asking somebody to save first is asking them to commit to the thing they
  pressed the button to doubt. `previewAiEnvironment` builds the environment
  the job *would* run in, through the same overlay the worker reads — a preview
  with rules of its own would prove the wrong thing on exactly the settings
  somebody is unsure about.
- `readAiKeySecret` is a second door to a plaintext, so it is a named function
  rather than a general read. Nothing that answers a browser calls it, and it
  answers null for a key that is not the account's.

## Log

- 2026-09-09T02:05+08:00 — Built. Six new cases — three on the route, three on
  the screen — and 1,538 tests pass, lint and typecheck clean. Migration 0051
  applied to the development database and the constraint now lists `key_test`.

  **Nothing has pressed the button against a real provider.** The probe path,
  the three states and the recorded row are proven against a fake, which is
  evidence about our half and none about a provider's. The first real press is
  worth reading carefully: what a wrong key answers, and how long a cold call
  takes.

- 2026-09-09T02:15+08:00 — **Test before save**, on the owner's word. The route
  takes the key and the model in the body rather than reading the row, so the
  button appears the moment a key is picked and tests what is on screen. It
  still writes nothing: a test is a call, not a save, and one case asserts the
  job's row is untouched afterwards.

  The key's provider still decides the job's on a test, exactly as on a save. A
  test that used a different rule would pass on a setup that then fails.
