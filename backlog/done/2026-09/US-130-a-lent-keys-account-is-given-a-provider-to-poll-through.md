---
id: US-130
title: A lent-keys account is given a provider to poll through
type: feature
priority: p2
created: 2026-09-13T12:24+08:00
parent: US-128
area:
resolution: shipped
---

## Context

**An account whose plan includes the keys never pastes one, so nothing ever
writes it a provider choice.** `recordChoiceForUnassigned` runs when a key is
saved on the connections screen — US-090 — and a lent-keys account saves none.
That is fine while the instance holds one key per platform, because
`decideProvider` answers with the only provider that can run. It stops being
fine the moment the instance holds two.

With two usable providers and no recorded choice, `registry.only` refuses:
`collect.ts` logs `no_provider_choice`, notes the source and skips it. The
platform then collects nothing, the monitor form said it was ready, and the poll
run is the only place that says why. The refusal is correct — US-026 decided
that spending somebody's money is not a default — but the person it refuses was
told this plan means not choosing anything.

**So the instance is held to one key per platform today, and that is a
constraint nobody wrote down.** It also costs money. `docs/costs.md` prices
ScrapeCreators at about a fifth of SocialCrawl per YouTube video and a quarter
per TikTok video, and SocialData at half of SocialCrawl per tweet — and adding
either key to `.env` would make those platforms ambiguous for every lent-keys
account on the instance.

**A default choice is the deployment's, not the customer's.** The key is the
deployment's, the bill is the deployment's, and the person on this plan has no
reason to hold an opinion about which scraper answers. That is the opposite of
US-026's case, where the key belongs to the person and choosing for them would
spend their money at an account they did not pick.

**A person may still change it.** The connections screen's provider control
does not require a stored key, so a lent-keys account can already pick — the
question here is only what happens when nobody has.

## Acceptance

- [x] A deployment can name which provider fetches each platform for accounts
      whose plan lends the keys: `KEYS_INCLUDED_PROVIDER_<PLATFORM>`, one per
      platform, the name derived the way a credential's is
- [x] An account on that plan with no recorded choice polls through the named
      provider, rather than being refused for having no choice
- [x] An account spending its own keys is unaffected: `accountKeys.choices`
      reads its rows, and the steps read whatever they are handed
- [x] A recorded choice still wins for an account spending its own keys. On
      the plan that lends the keys the deployment's answer is the only one:
      a row recorded before the plan is left in place and not read. That is
      the choice half of US-132's precedence box, done here because
      `choices()` decides it in one line; the key and model halves stay there
- [x] A named provider this build cannot run, or one that does not fetch the
      platform, or one it has switched off, is refused at boot — by the API
      and by the worker, each tested
- [x] With signup closed nothing changes: `spendsInstanceMoney` answers no
- [x] The monitor form and the poll agree: both read `accountKeys.choices`,
      and a test reads Reddit as ready with two keys on the instance and the
      deployment naming one, with the connections screen showing it in use
      and asking no choice
- [x] No test spends money. 2,200 pass

## Notes

- `packages/core/src/sources/registry.ts`, `decideProvider`, is where the answer
  is decided, and `ChoiceOptions.choices` is the shape a default would arrive
  in. Read it before choosing where to put this: the cheapest correct change may
  be to lay the deployment's defaults under the account's own choices in the one
  place they are read, rather than to write rows nobody asked for.
- Writing a row per account is the other shape and it has a cost: a row written
  before a person had an opinion is a row that looks like their decision, and
  US-026's rule is that a recorded choice is obeyed or refused and never quietly
  replaced.
- `live:lent-keys` is the instrument that would show this working, and it needs
  two provider keys in `.env` to show anything at all — today it runs on one.
- This blocks nothing about selling the plan. It blocks putting a second
  provider key on the instance, which is what makes the plan cheaper to serve.

## Log

- 2026-09-13T12:24+08:00 — Written. Found while recommending which providers a
  lent-keys instance should hold: the cheapest set is four keys, and four keys
  make four platforms ambiguous for every account on the plan.

- 2026-09-13T19:56+08:00 — Amended by US-132. The owner decided that an account
  on the lent-keys plan does not choose its provider at all, so the default this
  ticket adds is the whole answer there rather than a value a person may
  replace. The refusal that makes it so is US-132's; what stays here is the
  deployment naming the provider, which that ticket needs.

- 2026-09-15T18:05+08:00 — **Built.** The shape is the one the Notes hoped
  for: no rows written. `accountKeys` — the per-account object US-128 built
  for keys and US-129 for the cap — gained `choices(userId)`, and the seven
  readers of a provider choice (collect, replies, reconcile, estimate;
  connections, pricing, monitors) take a `choicesFor` function with the table
  read as the default, so a self-hosted instance and every existing test
  read exactly what they read before. The composition roots pass
  `keys.choices` and call `lentProvidersFrom` at boot.

  `recordChoiceForUnassigned` on the connections screen still reads the rows,
  on purpose: it is about what is recorded, and US-132 refuses the key write
  that triggers it for a lent-keys account anyway.

  One gap seen and left: with two keys and no choice, `startBlockers` reads a
  platform as ready — "one usable connector is enough" — while the poll
  refuses it as undecided. That predates this ticket and is not the lent-keys
  case; it is an own-keys account that pasted two keys and chose nothing.

- 2026-09-15T18:15+08:00 — **Closed.** Every box is true. `live:lent-keys`
  was not run: it needs two provider keys to show anything, and the model
  account behind `AI_API_KEY` had no credit on the day.
