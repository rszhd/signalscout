---
id: US-065
title: Voices to start from
type: feature
priority: p2
created: 2026-09-07T23:25+08:00
parent: US-040
area:
resolution: shipped
---

## Context

**The voices page opened on a blank box and the words "Create your first reply
voice".** That is the hardest screen in this product to answer: a person who
has never written an instruction does not know what a good one looks like, and
the ones they guess at tend to ask for exactly what `ai/reply.ts` refuses —
open with the product, sell harder.

The owner asked for a few more voices. Rather than typing rows into one
database, they ship as **presets in the product**: the same voices, available
to anybody who installs this, and a starting point instead of an empty field.

**Each preset is grounded in something this repository measured**, and says so
on the screen. `Reddit regular` exists because US-022 found that a subreddit
treats a promotional reply as an advertisement. `Technical detail` exists
because US-028 measured LinkedIn's noise as on-topic expertise-signalling.
`Short comment` exists because a TikTok comment runs a median of 54 characters
and an Instagram one 26. A preset a person does not understand is one they
cannot edit sensibly.

**They are starting points, not settings.** Choosing one fills the form as an
unsaved new voice; it is then saved, edited and deleted like anything a person
writes. Nothing is applied by default and a deployment that ignores them
behaves as it did.

## Acceptance

- [x] A set of reply voices ships with the product, each with the reason it
      exists shown beside it
- [x] One press adds a preset as a saved voice and opens it for editing
- [x] They are visible on the page as it opens, beside the saved voices, with
      voices already saved
- [x] One press adds one, and a preset already saved is not offered again
- [x] A page whose presets cannot be read still creates voices normally
- [x] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass

## Notes

- The presets live in `packages/core/src/ai/reply-voices.ts` and arrive over
  `/api/reply-prompts/presets`, because `apps/web` imports no core — the one
  architectural rule in the repository.
- None of them can override the prompt's fixed rules and none tries to. They
  steer register, length and shape.

## Log

- 2026-09-07T23:25+08:00 — Written when the owner asked for more voices, and
  scoped as a product feature rather than five rows in one database.

- 2026-09-07T23:39+08:00 — Built and closed. **1,373 tests pass**, lint and
  typecheck clean, and all five render in a real browser.

  Five voices: **Answer first**, **Reddit regular**, **One good question**,
  **Technical detail**, **Short comment**.

  **The browser found the mistake that mattered.** The first version put the
  presets on the empty state only — which hid them from exactly the person who
  asked for them, somebody with one voice saved who wants a few more. With one
  row in the table the page opens in edit mode and the empty state never
  renders. They are now on the new-voice form as well, and deliberately not
  while editing a saved voice, where the button would silently overwrite words
  somebody wrote.

  One robustness fix came out of the tests: the page read `presets` from the
  route without checking the shape, so a route answering something unexpected
  threw inside a render. Presets are a way to start, not a way to work — the
  blank form has to survive losing them.

- 2026-09-07T23:52+08:00 — **Corrected, because the owner could not find them.**
  They reported seeing one voice on the page, and they were right: the presets
  were behind the New voice button, so the page said "Saved voices 1" and the
  five may as well not have shipped.

  Two mistakes in one design, and the second was worse. **They were invisible**
  — the page opens in edit mode whenever a voice exists, so the empty state
  that carried them never rendered. And **choosing one only filled the form**,
  which turned "add a few more voices" into a form to complete five times.

  They now sit under the saved list, where somebody counting their voices is
  looking, and one press adds one. The button says "Add" so a saved row is not
  a surprise, the new voice opens for editing because a preset is a starting
  point, and a preset already saved is not offered again — offering it would
  only produce the duplicate-name refusal.

  Verified in the browser: one press took the count from 1 to 2, left four
  presets, opened "Reddit regular" for editing and wrote the row. The test row
  was removed afterwards, so the five are the owner's to add.

  The lesson is not about presets. **A feature nobody can find did not ship**,
  and the way to know is to open the page in the state the person is actually
  in — one saved voice, not zero.
- 2026-09-09T00:46+08:00 — **Reversed, on the owner's decision: an account now
  starts with all five saved.** This ticket's Context says they are starting
  points and not settings, and that is what changed. The reason it was worth
  changing is the same one the ticket opened with — a person who has never
  written an instruction cannot judge five names on a page, and reading a real
  draft in a voice is what tells them which one they want. A press is one more
  decision asked before the moment that would inform it.

  `seedPresetReplyVoices` in `ai/reply-prompts.ts` is the whole rule, and it is
  called from `user.create.after` for every account. There, and not in the
  sign-up route, for that hook's own reason: it is what every path that creates
  a user goes through. It runs **after** `claimUnownedRows`, and that ordering
  is what makes a conflict harmless — an instance older than the login may
  already hold a voice called "Short comment", and those are somebody's words.
  Conflicts do nothing, so the function is safe to run twice and never
  overwrites.

  Migration 0049 is the same five rows for accounts that already existed. It
  carries the preset text as a SQL snapshot, generated from the module rather
  than retyped, and it will drift on purpose: rewriting old rows to follow the
  module later would overwrite whatever a person has since edited.

  **Proven on the development database**, which is the half a test could not
  reach. Three accounts, and the one that had written its own "Short and plain"
  came out with six voices while the other two have five. No row was
  overwritten.

  The screen needed no change, and that is `VoicePresets` returning null when
  every preset is saved: the picker is simply absent on a fresh account and
  comes back the moment somebody deletes a voice. The box the ticket ticked —
  *a preset already saved is not offered again* — is what makes the new default
  read correctly.
