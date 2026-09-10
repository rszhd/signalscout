---
id: US-107
title: Setup asks which provider, and preselects none
type: feature
priority: p2
created: 2026-09-10T14:05+08:00
parent: US-088
area: web
resolution: shipped
---

## Context

**The setup gate answers the provider question for the person, and it should
ask it.** US-088 put a `<select>` on each of the two steps and gave each one a
value: the data provider defaults to SocialCrawl where this build registers it,
and the model provider defaults to whatever this deployment is configured for.
A select must carry a value, so the default was a guess about which account the
person holds.

**A guess that looks like an answer is the fault.** The first field on the
first screen of the product already reads as decided, so a person with a Bright
Data key pastes it into a field labelled for SocialCrawl, and the provider
refuses it. The refusal is the provider's own sentence — a wrong key — and it
says nothing about the real mistake, which is that nobody chose. The key is
tested before it is stored, so nothing is lost but the person's confidence on
their first minute in the product.

**Nothing is preselected now, on both steps.** The person picks a provider and
the fields for that provider appear under it. A step with no choice made offers
no key field and no save.

**A radio list of cards rather than a select with an empty option.** The
connections screen already picks a provider this way — `provider-choice` and
`provider-option` — so the shape is the product's own and not a new one. It
also carries what a select cannot: the brand mark, and the platforms one key
unlocks. That last line is the reason a person can choose at all, and on a
select it was below the control and read as a consequence rather than as the
grounds for the decision.

The rest is polish on the same page: the website link says what a person came
to it for, the key fields sit in a panel belonging to the chosen provider, and
the two steps read as one numbered path.

## Acceptance

- [x] The setup gate preselects no data provider. Nothing is chosen until a
      person chooses.
- [x] The setup gate preselects no model provider.
- [x] A key field appears only under the provider that was chosen.
- [x] The save button is unavailable until a provider is chosen.
- [x] Choosing a provider shows what that one key fetches, before the key is
      pasted.
- [x] The provider website link still points at the chosen provider and still
      opens in a new tab.
- [x] Changing the choice clears what was typed for the provider before it.
- [x] The suite, lint, typecheck and build are clean.

## Notes

- `apps/web/src/Onboarding.tsx`
- `apps/web/src/Onboarding.test.tsx`
- `apps/web/src/styles/onboarding.css`

US-088's preselection is reversed here, and its reasoning is recorded in this
Context rather than deleted: SocialCrawl unlocking six platforms is still true,
and it is now said on the card instead of chosen on the person's behalf.

## Log

- 2026-09-10T14:05+08:00 — Written.
- 2026-09-10T14:20+08:00 — Done. Both steps of the setup gate start on no
  provider. `ProviderChoice` in `apps/web/src/Onboarding.tsx` is the one control
  both use: a radio list of rows carrying the brand mark, the provider's name,
  and either the platforms one key unlocks or the model a key is tested with.
  The key fields appear inside a panel under the chosen provider, and the save
  button is unavailable until a choice is made.

  **The two selects are gone.** US-088's data-provider select started on
  SocialCrawl and its model select on whatever the deployment is configured
  for. Both facts are still true and both are now said on a row rather than
  chosen for the person.

  The website link kept its `aria-label` and changed its words to "Get a key
  from <provider>", which is what somebody on this screen is going to that site
  to do.

  `radio()` joined `apps/web/src/testing.js`. Radios were reached through
  `querySelectorAll("input[type=radio]")` before, which finds a control by its
  markup rather than by its label — the thing docs/testing.md asks against.

  Tests: 13 in `Onboarding.test.tsx`, four of them new — no data provider is
  preselected, no model provider is preselected, changing the choice clears the
  typed key, and a row says what its provider fetches. `App.test.tsx`'s
  `finishSetup` now picks both providers, the way a person does.

  Three deliberate mutations were confirmed to turn the suite red: preselecting
  the first data provider (2 failures), preselecting the first model provider
  (2), and keeping the typed key across a change of choice (1).

  1,845 tests pass. Lint, typecheck and `pnpm build` are clean.

  **Unproven: no real browser has rendered it.** The screen is driven through
  jsdom only, which is US-088's own open gap and not a new one. Nobody has seen
  the rows, the checked state or the panel on a real page.
