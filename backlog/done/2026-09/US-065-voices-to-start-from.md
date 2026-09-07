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
- [x] Choosing one fills the form and saves nothing until a person says so
- [x] They are offered wherever a *new* voice is made, not only on an empty
      page
- [x] They are never offered while editing a saved voice, so nothing somebody
      wrote is overwritten
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
