---
id: US-078
title: A model key is pasted once
type: feature
priority: p2
created: 2026-09-09T00:52+08:00
parent: US-068
area:
resolution: done
---

## Context

US-068 gave a person four cards — scoring, triage, similarity, drafting — and a
key box on each. The owner reported the consequence from a running instance: a
key has to be entered for every job.

It was half true, and the half that worked is the half that hid it. `config.ts`
shares one key in a single direction: triage, drafting and similarity fall back
to the **classifier's** key when they run on the classifier's provider. So an
account with everything on one provider pastes once and never notices. An
account that does what these four cards exist for does not. Scoring on
Anthropic and triage and drafting on OpenAI means pasting the same OpenAI key
onto two cards — and the second copy is the one nobody rotates.

The screen made it worse by describing the wrong rule. An empty key box said
*"Leave empty to use the key configured for this instance"*, which on a hosted
account is a key that does not exist. A person reading that pastes again.

Nothing here changes what a key may cross. An Anthropic key sent to OpenAI
fails every call and the sentence a person then reads points at the wrong
thing.

## Acceptance

- [x] A job with no key of its own uses a key stored on any job running the
      same provider
- [x] A job's own key still wins over a borrowed one
- [x] A key never travels to a job on a different provider
- [x] The screen says which job a borrowed key is stored on, and its mask
- [x] The screen and the worker read one function, so they cannot disagree
- [x] An account that has stored nothing behaves exactly as before

## Notes

- The rule is `keySourcesFor` in `ai/settings.ts`, and it asks `config.ts` for
  each job's provider rather than working it out again. Those four functions
  hold rules that took measurements to get right, and a second copy is how one
  of them ends up wrong.
- `keyOrder` — scoring, triage, drafting, similarity — settles which row lends
  when two could. Fixed rather than arbitrary: a person who reads "from
  Scoring" on three cards can find the one row that pays for everything.
- `aiKeySources` answers from the masks alone, never the keys, because its
  answer goes to a browser.
- Storage did not change. A key still belongs to the row it was pasted on, so
  removing it is still one button on one card, and no migration was needed.

## Log

- 2026-09-09T00:58+08:00 — Built and tested. Four cases in
  `ai/settings.test.ts` and one each in `models.test.ts` and
  `Models.test.tsx`: a key lends across jobs, it never crosses a provider, a
  job's own key wins, and the sentence on the card names the same lender the
  worker uses.

  The lending case was confirmed to fail before the change, by disabling the
  one line that fills a borrowed key — the rest of the suite stayed green,
  which is what the case is for.

  1,522 tests pass, lint and typecheck clean. **No live model call has been
  made on a borrowed key**, which is the same gap US-068 recorded: no model
  provider here has a free probe, so nothing verifies a real provider accepting
  the key one card lends another.
- 2026-09-09T01:22+08:00 — **Replaced by
  [US-079](US-079-a-model-key-is-added-once-and-chosen-per-job.md), the same
  day, before either shipped.** The owner read the rule this ticket added and
  said it was confusing. It was: to answer "whose key pays for this job?" a
  person had to know where a key was kept *and* which other cards would reach
  for it. The complaint this ticket started from was right, and the fix was a
  rule where the answer was a list. `keySourcesFor`, `aiKeySources` and the
  "from Drafting a reply" sentence are all gone; a key is now a row a person
  adds once and a job names one.

  What survives is the sentence about the screen. **A card that describes a
  different rule from the one that runs is worse than a card that says
  nothing** — that was true of "use the key configured for this instance", and
  it is why the picker now shows the choice itself rather than a description of
  one.
