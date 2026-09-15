---
id: US-132
title: The deployment chooses the model and the provider on the lent-keys plan
type: feature
priority: p1
created: 2026-09-13T19:52+08:00
parent: US-128
area:
resolution:
---

## Context

**An account whose plan lends this instance's keys can still choose what those
keys are spent on.** US-128 moved the question of *whose* keys a poll spends to
the account. It left every screen that decides *what they are spent on* open to
everybody, because no route reads the plan before it writes.

Four writes carry no plan check today:

- `PUT /api/connections/:provider` stores a provider key.
- `PUT /api/platforms/:platform/provider` records which provider fetches a
  platform. It needs no key at all.
- `PUT /api/models/:task` and `POST /api/models/keys` store a model choice and a
  model key.
- `POST /api/connections/:provider/test` and `POST /api/models/:task/test` make
  a billed call.

**The model half is the one that costs us.** `readAiSettingsEnvironment` lays an
account's rows over the instance's environment, and an account may store a model
name without storing a key. So a lent-keys account can point *our* key at the
most expensive model the provider sells, and the deployment pays the difference.
The cap in US-129 bounds the month. It does not stop the choice.

**The provider half is the same shape, one step behind.** This instance holds
one key per platform today, so there is nothing to switch to. The moment it
holds two — ScrapeCreators beside SocialCrawl, which docs/costs.md prices at
about a fifth per YouTube video — a lent-keys account can move the bill to the
dearer one.

**The plan is a plan, so the deployment chooses.** The person on it asked not to
hold accounts and not to paste keys. Deciding which scraper answers and which
model scores is not a thing they were sold, and it is not a thing they should be
able to spend our money on. An account spending its own keys keeps every choice
it has today: US-026 decided that spending somebody's money is not a default,
and that reasoning is untouched here because the money is not ours.

**A stored row that predates the plan must stop winning.**
`worker/credentials.ts` documents the order: the table first, the environment
second, and *once a row exists, it wins*. An account that pasted a key in March
and moves onto this plan in April would keep polling on its own key while paying
for one it does not use. On this plan the environment wins, and the rows are
left where they are so that leaving the plan restores them.

**The screens stay at their addresses.** The billing page links to connections
in one word — "See connections" — and hiding the route would make that a dead
link. What changes is what they are: a statement of which provider fetches each
platform and which model reads each task, with no field, no test button and no
key.

This amends **US-130**, which is open and which says a recorded choice still
wins. That box now belongs to accounts spending their own keys. For a lent-keys
account the deployment's answer is the only one, which also removes the case
US-130 was written to avoid: no choice, two providers, and a refused poll.

## Acceptance

- [x] One rule decides it, asked per account: `accountKeys.spendsInstanceMoney`
      is `spendsInstanceMoney(signup, plan)` for one account, reused rather
      than copied
- [x] Every write that chooses a provider, a model or a key is refused for an
      account the deployment pays for: eleven routes today under three
      prefixes — `/api/connections`, `/api/platforms/`, `/api/models`
- [x] The refusal is **403** with a sentence naming the plan and the repair
- [x] The refusal is proved by walking every route the build registers, the
      way `billing.test.ts` walks them; a route added under a prefix later is
      refused without a test naming it
- [x] A stored provider key, a stored provider choice and stored model rows
      are ignored while the account is on the plan. The choice half was
      US-130's; the key half is `credentialsForAccounts`, the model half is
      `readAiEnvironmentFor`, and both composition roots call them
- [x] Nothing stored is deleted. Tests move an account off the plan and read
      its key row and its model row again
- [ ] The connections screen and the Models screen say what the deployment
      uses. **The next session**, as the Notes say — the backend stops here.
      Both GET routes answer 200 to an account on the plan today, and still
      show its controls; the screens need a flag and a shape the screen
      session decides
- [x] Both screens keep their addresses: no route was removed
- [x] An account spending its own keys is unaffected: the walk asserts no 403
      for it, and its rows still win
- [x] With signup closed nothing changes: the gate is not registered, and
      `spendsInstanceMoney` answers no
- [x] US-130's acceptance was amended in that change
- [x] Every rule that reads the database is asserted against real Postgres
- [x] No test reaches a provider, Stripe or a model

## Notes

- The rule belongs beside the others, in `config/machine-keys.ts`, and it is a
  question about money rather than about keys. `spendsInstanceMoney` is that
  question and already carries the reasoning for why closed signup answers no.
- Count the readers before writing the refusal. US-128 named six seams: four in
  the API — connections, pricing, the monitor routes, the Models screen — and
  two in the worker. BUG-009 and BUG-019 were both a rule applied to three of
  four callers.
- The precedence inversion is the part that will be forgotten. It lives in
  `worker/credentials.ts` and in `readAiSettingsEnvironment`, and both file
  headers state the old order in prose. Rewrite both, and docs/secrets.md,
  *Whose key is it*, in the same change.
- A key test on this plan would spend the deployment's money on a key the person
  cannot change. Refuse it rather than let it read as broken.
- **Build the backend, then stop.** The rule, the refusals and the precedence
  are one session. The two screens are the next one, and they are reviewed
  before they are started.
- US-131 is Checkout offering the plan. It does not depend on this, and this
  does not depend on it. Both are wanted before the plan is sold.

## Log

- 2026-09-13T19:52+08:00 — Written. The owner ran the plan on a development
  instance for the first time, saw the connections and Models screens still
  offering their controls to a lent-keys account, and asked for the deployment
  to hold both choices.

- 2026-09-15T18:06+08:00 — US-130 did the provider-choice half of the
  precedence box: `accountKeys.choices` answers a lent-keys account with the
  deployment's named provider and reads none of its rows. What stays here is
  the stored provider key, the stored model rows, the eight refused writes and
  the two screens.

- 2026-09-15T18:50+08:00 — **Backend built; the screens wait.** The gate is
  an `onRequest` hook registered after the paywall and only where signup is
  open and billing is on, so a self-hosted instance pays no read for it. It
  refuses by prefix rather than by list, for the reason the paywall walks
  every route.

  The two precedence flips live where each order was written: the key half
  in `credentialsForAccounts`, which now hands a lent-keys account the
  environment lookup and everybody else the store; the model half in a new
  `readAiEnvironmentFor` in `ai/settings.ts`, which both roots call so the
  worker and the API cannot disagree. The worker's `modelsFor` calls it with
  `spendsInstanceMoney(signup, plan)` from the plan it already reads per job;
  that call site is asserted only by reading, because an injected classifier
  wins over the environment in every worker test. The API seam is asserted
  with a stored row and a plan change.

  Seen and left for the screen session: `GET /api/connections` still reports
  the account's stored keys as connected for a lent-keys account, and
  `GET /api/models` still shows its rows. Neither is read by a poll now, so
  the screens are the only readers that lie.
