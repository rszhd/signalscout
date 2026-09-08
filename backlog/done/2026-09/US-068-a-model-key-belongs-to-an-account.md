---
id: US-068
title: A model key belongs to an account
type: feature
priority: p1
created: 2026-09-08T03:46+08:00
parent: US-017
area:
resolution: done
---

## Context

The other half of what US-067 starts. A provider key is a row in a table with a
key that can gain a column; a model key is not, and that is why it is a separate
ticket.

`AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` are read from the environment, and
`startWorker` builds **one** classifier, one embedder and one triager from them
at boot. Every step closes over those three. Making the key belong to an account
means building them per monitor owner rather than once, which changes the
worker's shape rather than a table's key. The API needs the same for the three
places it calls a model directly: the query generator, the project describer and
the reply drafter.

Everything an account can spend is already recorded per monitor —
`model_calls`, `api_usage` and the budget guard all key on the monitor, and a
monitor carries its owner. So the money is already attributable. What is not
scoped is whose key pays.

The instance keeps `AI_PROVIDER` and `AI_MODEL` as the deployment's choice, and
the environment key stays the fallback, so a self-hoster changes nothing. What a
person stores is a key of their own, and — if this is worth the extra field — a
provider and model of their own, since a cloud user on OpenAI should not be
forced onto the instance's Anthropic default.

## Acceptance

- [x] A person stores their own model key, encrypted, on a screen
- [ ] **The key is tested with the provider before it is stored.** Not built.
      See the Log: unlike Reddit through Bright Data, no model provider has a
      free probe, so validating a key spends the person's money on a call they
      did not ask for. That is its own decision.
- [x] The classifier, the embedder and the triager a poll uses are built from
      the monitor owner's key, falling back to the environment
- [x] The three model calls the API makes — query generation, project
      describing, reply drafting — use the signed-in person's key
- [x] A monitor whose owner has no key, on an instance with no environment key,
      scores nothing and says why, keeping its posts for the next poll
- [x] Building a client per owner does not build one per job; a cache is keyed
      by owner and the docs say what invalidates it
- [x] One account's model key is never readable by another, asserted against
      real Postgres
- [x] The cost of a call is still recorded against the monitor, whoever's key
      paid for it

## Notes

- Depends on [US-067](US-067-a-provider-key-belongs-to-an-account.md) for the
  owner column and the store's shape.
- Open question the ticket must settle before it is built: whether a person
  chooses their own provider and model, or only supplies a key for the
  instance's choice. The second is smaller; the first is what a cloud tier
  probably needs.
- `AI_EMBEDDING_*` and `AI_TRIAGE_*` fall back to the classifier's settings
  today. Whatever is stored per account has to keep that fallback, or a person
  who pastes one key loses the triage stage without being told.

## Log

- 2026-09-08T03:46+08:00 — Written beside US-067, from the same request.
- 2026-09-08T11:40+08:00 — The owner settled the open question: per-task
  provider *and* model, not just a key for the instance's choice. Three tasks,
  the same three the environment already names.
- 2026-09-08T11:45+08:00 — **The design is one idea: a stored row is an
  override of the environment.** `readAiEnvironment` lays an account's rows over
  the instance's `AiEnvironment` and hands the result to the same three
  functions in `ai/config.ts` that have always read it. Not one of their
  fallback rules is reimplemented — triage falling back to the classifier's
  settings but not its price, a key reused only within one provider, an
  embedding model never guessed. Every one of those took a measurement to get
  right, and a second copy is how one of them ends up wrong. It also means a
  person who pastes only a key needs no other field, and an account with no rows
  behaves exactly as before.
- 2026-09-08T11:48+08:00 — The worker builds clients per monitor owner and
  caches them for the life of the process. That cache is the one real cost of
  the design: **a model key changed on the screen reaches the API immediately
  and the worker on its next restart.** Written into docs/secrets.md rather than
  left to be discovered. The API does not cache — a route already costs a round
  trip and this is one small read.
- 2026-09-08T11:52+08:00 — `unconfiguredClassify` is deleted. The classify step
  now decides for itself, because the answer is per monitor rather than per
  deployment, and its message names both places a key can come from.
- 2026-09-08T11:55+08:00 — **The tests all passed before any of this was
  covered, and that is worth naming.** Every existing test injects a client
  into `startWorker`, which still wins over the resolver — so the whole new path
  was invisible to a green suite. `ai/settings.test.ts` and
  `worker/classify-owner.test.ts` are what actually exercise it.
- 2026-09-08T12:00+08:00 — Closed. 1,443 tests pass. Migration 0046 applied to
  the development database.

  Unproven: no live model call has been made on a per-account key. Doing it
  would spend money at a real provider, and the layering it would exercise is
  asserted through `aiConfigFromEnvironment` and its two siblings rather than
  through a shape this file invented.
