---
id: US-079
title: A model key is added once and chosen per job
type: feature
priority: p2
created: 2026-09-09T01:05+08:00
parent: US-068
area:
resolution: done
---

## Context

US-068 put a key box on each of the four job cards, so a key belonged to a job.
US-078 then noticed that a person with one key had to paste it more than once,
and answered with a rule: a job with no key of its own borrows the key stored
on any job running the same provider.

The owner read that and said it was confusing, and it was. It asked a person to
hold two ideas at the same time — where a key is kept, and which cards will
quietly reach for it — to answer one question, *whose key pays for this job?*

A key is a thing you own. So it is a row of its own, added once and named, and
a job points at one. Two jobs sharing a key is then something visible on the
screen rather than a rule to learn, and a person who uses two providers adds
two keys and picks.

## Acceptance

- [x] A key is added on the account, with a name, and not on a job
- [x] Every job picks from that list, and several jobs may pick the same key
- [x] A job that picks nothing runs on the instance's key, as before
- [x] Deleting a key puts every job that named it back on the instance's key
- [x] A key belonging to another account is refused
- [x] A job takes its provider from the key, when the key names one
- [x] A key whose provider cannot do that job is refused, by name
- [x] The provider list on a job offers providers, not settings
- [x] The model list on a job offers only that provider's models
- [x] Two keys cannot share a name
- [x] Existing per-job keys move across with nobody retyping one
- [x] `pnpm db:rotate-key` re-encrypts model keys

## Notes

- `ai_keys` holds the ciphertext; `ai_settings.key_id` is a reference with
  `on delete set null`. A job left pointing at a deleted row would fail every
  call with nothing able to say why.
- `record` travels with the ciphertext, which is why migration 0050 is a move
  and not a re-encryption. That column has been stored per row since US-024 for
  exactly this.
- `provider` on a key **decides the job's provider**, when the key states one.
  The card then shows it rather than asking. Two fields for one answer is how
  somebody ends up with an OpenAI key on an Anthropic job, which fails every
  call and reads as a bad key. A key that states no provider decides nothing.
- No secret passes through `saveAiTaskSettings` any more. `ai/keys.ts` is the
  one place a model key is written.
- `config.ts` is untouched. A job with no key still falls back the way it
  always did, and the rules US-030 measured are where they were.

## Log

- 2026-09-09T01:20+08:00 — Built. US-078's lending rule and `aiKeySources` are
  gone; the screen has a key list above the jobs and a picker on each card.

  **The rotation gap was found on the way and fixed.** `rotateEncryptionKey`
  only ever walked `source_credentials`, so model keys were left on the old key
  since US-068 — a rotation that reports success and then fails every model
  call the moment the old key is thrown away. It now walks both tables and
  counts both, and `store.test.ts` asserts a model key opens under the new key.

  **Migration 0050 ran against the development database.** Two per-job keys
  became two account keys — named `Scoring key` and `Drafting key`, both
  `••••xSwA`, which is the same key pasted twice and is the complaint the owner
  reported. Both jobs still point at their own row, and `readAiEnvironment`
  decrypted both afterwards: the ciphertext moved tables and nobody retyped a
  key.

  1,527 tests pass, lint and typecheck clean. Unproven, as in US-068: **no live
  model call has been made on an account's key**, and a key is still not tested
  with the provider before it is stored, because no model provider here has a
  free probe.

- 2026-09-09T01:35+08:00 — **The card stopped asking for a provider it had
  already been told.** The owner asked why a person who has just stored "my
  OpenAI key" is then asked which provider the job runs on. There was no good
  answer: one question, two fields, and the wrong pairing fails every call
  while reading as a bad key.

  A key's stated provider is now written to the job on save, so the screen, the
  worker and `config.ts` read one answer rather than two that can disagree. The
  card shows the provider instead of offering it, and the select comes back for
  a key that states none, or for a job on the instance's key.

  The refusal got its own sentence for the same reason. An Anthropic key picked
  for similarity now answers *"My Anthropic key" is an anthropic key, and this
  build cannot use anthropic for that job* — the old wording named a provider
  to somebody who had chosen a key.

  1,530 tests pass.

- 2026-09-09T01:48+08:00 — Two more, both about a list that offered the wrong
  thing.

  **The provider list no longer opens on "Instance default · Anthropic".** It
  names providers only, and the value is the one the job will run on — the
  instance's until somebody changes it. A first entry naming a *setting* asked
  a person to know what the instance was set to in order to read their own job.
  The sentence under it still says which provider the instance runs on, because
  that is worth knowing and is not worth being an option.

  **The model list follows the provider.** `modelPrices` now records which
  provider sells each model and `pricedModelsFor` reads it, so the card offers
  three Anthropic names or three OpenAI ones rather than all six. Ollama
  answers with an empty list, which is honest: its models are whatever somebody
  pulled, and the field still takes any name. The list is per card and follows
  the provider being *chosen*, not the one saved.

  1,532 tests pass.

- 2026-09-09T02:25+08:00 — **The picker stopped offering a key the machine does
  not have.** The owner asked whether "this instance's key" is offered only
  when there is one, and it was not: the option was unconditional, so on a
  hosted account — where no `AI_API_KEY` is set — choosing it chose no key at
  all, and the way that shows up is a poll that scores nothing.

  `instance.hasKey` now travels with each job, and it is asked of `config.ts`
  rather than of the environment: "the instance's key" for triage is the
  classifier's when triage names none, and a second copy of that fallback would
  answer a different question from the one the worker answers. A local runtime
  needs no key and answers true, so "no key" is not read as "cannot run" there.

  Where there is none the option reads *No key — this job cannot run*, with a
  line naming the provider the instance lacks a key for. 1,540 tests pass.

- 2026-09-09T02:40+08:00 — **Audited the whole screen rather than the last
  complaint, after the owner asked for it.** Four things were wrong, and one of
  them predates this ticket.

  **The provider now follows the key in both directions.** Picking a key set
  the job's provider; picking the instance's key left the previous key's
  provider behind, pointing the job at a provider nothing on the card mentioned
  any more. And the model follows the provider: a name this build prices under
  another provider is cleared, while an unlisted name — somebody's local model,
  a new release — is left alone, because clearing it would delete a correct
  answer.

  **The environment overlay was sending the machine's key to a provider it did
  not come from.** US-068's hole, not this ticket's: an account can move a job
  to OpenAI without storing a key, and the instance's Anthropic key stayed
  underneath it. Every call fails and the sentence a person reads blames a key
  they never chose. `moved()` in `overlay` drops the instance's key and base URL
  for a job whose provider the account changed without supplying one — which is
  `config.ts`'s own rule applied at the seam where the provider moves. Three
  cases, and disabling the one line turns two of them red.

  **A job now offers only the keys it could use.** Similarity cannot run on
  Anthropic, so an Anthropic key there was a refusal offered as a choice. A key
  naming no provider is still offered everywhere: nobody said where it belongs.

  **Similarity offers a model again.** No embedding price has ever been read
  here, so the priced list is empty for it and the card offered nothing on the
  one job that needs a name to run. `defaultEmbeddingModels` fills that list.

  1,545 tests pass.

- 2026-09-09T03:15+08:00 — One more from re-reading the card end to end: **the
  model was still falling back to the instance's on a job that had left the
  instance's provider.** `claude-haiku-4-5` is not a name OpenAI answers to, so
  picking an OpenAI key and saving without typing a model stored a setting that
  fails every call — quietly, at whatever hour the schedule picked, reading as a
  bad key.

  The instance's model is now a fallback only on the instance's provider.
  Elsewhere the job has no model until somebody names one: the field says so,
  Save is refused, the Test button is absent, and the route refuses the same
  write — the server being the one that has to be right.

- 2026-09-09T03:35+08:00 — **The screen was rebuilt from scratch**, on the
  owner's word that it was a mess. It was: the rules underneath had been
  corrected six times in one session and the layout had not moved once, so it
  still asked for a provider beside a key that named one, hid every job behind
  a disclosure, and buried the answer to the only question a person comes here
  with — *what does this job run, and who pays for it?*

  It is two sections down one column now. **API keys** first, because that is
  what a person does first. Then **Jobs**, all four open, divided by a rule
  rather than boxed: four is few, comparing them is the normal reason to be
  here, and a disclosure per job hid exactly that.

  Each job is three fields in the order the answers come — key, provider,
  model — and one sentence underneath saying what it would do: *Runs
  gpt-5.6-terra on OpenAI, paid by My OpenAI key · ••••abcd.* Base URL and the
  measurement behind the job moved into Advanced.

  `models.css` was rewritten against the tokens: no local grays, no card around
  every section, one column at 720px. **No behaviour changed, and the tests are
  the evidence** — all eighteen cases written against the old markup passed
  against the new, with one line moved because a `datalist` id changed.
