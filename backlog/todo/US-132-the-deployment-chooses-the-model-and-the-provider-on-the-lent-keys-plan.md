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

- [ ] One rule decides it, asked per account. `spendsInstanceMoney(signup,
      plan)` already asks exactly this question — open signup and the plan that
      lends the keys — and is reused rather than copied under a second name
- [ ] Every write that chooses a provider, a model or a key is refused for an
      account the deployment pays for: both connections writes, both platform
      provider writes, both key tests, and every `/api/models` write
- [ ] The refusal is **403** with a reason naming the plan. Not 402: the account
      has paid, and "this is the deployment's choice" and "this account has not
      paid" send a person to two different places
- [ ] The refusal is proved by walking every route the build registers, the way
      `billing.test.ts` walks them, so a route added later cannot escape it
- [ ] A stored provider key, a stored provider choice and stored model rows are
      ignored while the account is on the plan. The environment answers instead
- [ ] Nothing stored is deleted. An account that leaves the plan polls on its own
      rows again, with no re-entry
- [ ] The connections screen and the Models screen say what the deployment uses:
      the provider per platform, the model per task, and that the plan includes
      them. No key field, no test button, no provider control
- [ ] Both screens keep their addresses, and the billing page's link still works
- [ ] An account spending its own keys is unaffected. Every write it makes today
      it makes after this
- [ ] With signup closed nothing changes. The self-hosted instance chooses
      everything, because the money is the operator's own
- [ ] US-130's acceptance is amended in this change: a recorded choice wins for
      an account spending its own keys
- [ ] Every rule that reads the database is asserted against real Postgres
- [ ] No test reaches a provider, Stripe or a model

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
