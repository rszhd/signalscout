---
id: US-128
title: A plan includes the keys, so nobody pastes one
type: feature
priority: p1
created: 2026-09-12T12:10+08:00
parent:
area:
resolution:
---

## Context

**The cloud version asks a new person for six accounts before it can find them
one lead.** A provider key for every platform they tick, and a model key on top
of it. Each one is a signup elsewhere, a card, and a dashboard to find the key
in. US-067 made that possible per account and US-081 made it required: where
signup is open, the keys in `.env` are nobody's to spend. So the hosted product
today is a subscription that buys scheduling and a screen, and the person still
buys the data.

This adds a second plan. **Keys included: the account polls and classifies on
the instance's own keys, and the connections and Models screens ask for
nothing.** The bring-your-own-keys plan stays beside it at the current price,
for the person who already holds the accounts and would rather pay the provider
directly.

**This reverses a standing decision, and the owner asked for it.**
`backlog/README.md` lists *bring your own keys ... this is not a fallback mode,
it is the product*, and PLAN.md says the same under *Bring Your Own Keys*. The
decision holds for the self-hosted build, which is unchanged and stays the whole
application. What changes is the hosted one, which PLAN.md already describes as
monetizing convenience — this is that sentence one step further. Both documents
say so in this ticket's commit, or the next agent reads a rule that is no longer
true.

**US-081's rule does not go away. It stops being a fact about the instance and
becomes a question about the account.** Today `machineKeysUsable(signup)` is
asked once per composition root and the whole process is handed an environment
with the keys already gone. That is the design's strength — nothing downstream
needs a branch — and it is exactly what has to change: three seams that read the
environment once must read it per owner instead. The worker's already does;
`credentialsFromStore` already takes a `userId`; the API's `aiEnvironmentFor`
already returns a function of one.

**The fail-safe direction is not spending our money.** An account with no
subscription row is entitled to write and poll — `entitlementFor` says so, and
the reasoning is the owner's own account and every self-hosted instance. It must
not also mean keys included. No row, an unknown Stripe price, a plan column the
webhook has not written yet: every one of them reads as bring-your-own-keys. The
only thing that opens the machine's keys is a row that says so.

**The webhook signing secret does not follow.** `webhookSecretEnvironment` looks
like the same rule and is not. It is stripped because the contract hands the
secret to the customer, so a shared one lets any account forge a delivery
another's receiver accepts. That harm is not money and a paid plan does not
settle it. A keys-included account still generates its own.

**The plan is not sold until [US-129](US-129-an-account-has-a-monthly-cap-on-the-instances-money.md)
closes.** `budgets` are per monitor and optional, and BUG-004 says the model half
of a poll is capped by nothing at all. An account spending our providers with no
account-level cap is an open invoice, and docs/costs.md names the shape of the
worst case: an Instagram comment is the dearest item this product fetches. Build
this, keep the price out of Checkout, close US-129, then sell it.

## Acceptance

- [x] `subscriptions` carries the plan, as a column with a check constraint and
      a migration in this change, and `meta/_journal.json` names the file
- [x] The plan is written from the Stripe price the subscription names, by the
      webhook. Nothing sets it by hand and no screen asks for it
- [x] A price this deployment does not recognise writes bring-your-own-keys and
      logs, rather than guessing
- [x] No row, no plan column value, and `BILLING_MODE=off` all read as
      bring-your-own-keys
- [x] With signup closed, nothing changes anywhere. The self-hosted instance
      meets none of this
- [x] A keys-included account polls on the instance's provider keys and
      classifies on its model key, without storing one of its own
- [x] A bring-your-own-keys account on the same instance is refused both, and
      the refusal is the one US-081 already ships
- [x] The connections screen, the Models screen and the monitor form all answer
      per account, so none of them offers a key the poll would refuse
- [x] The instance's webhook signing secret is still not shared, on any plan
- [x] An account that moves back to bring-your-own-keys has its monitors
      reported as missing a key, rather than failing at the next poll
- [x] That move reaches the worker without a restart. The model client cache is
      keyed by userId and lives as long as the process, and a plan that stops
      may not wait for one
- [x] Every rule that reads the database is asserted against real Postgres, the
      way entitlement is
- [x] Checkout does not offer the keys-included price while US-129 is open
- [x] No test reaches Stripe, a provider or a model

## Notes

- `packages/core/src/config/machine-keys.ts` is the whole rule today and stays
  the whole rule. Give it the account: one function, asked per owner, and every
  layer below keeps its missing branch.
- The three seams that read it once: `apps/api/src/server.ts` (`providerKeys`
  and the Models screen's env), `packages/core/src/worker/runtime.ts` (`lookup`
  and `readAccountBaseEnvironment`), and `aiEnvironmentFor`. The worker's
  `modelsFor(userId)` is already per owner and already cached — the plan belongs
  in the cache key or is read per job.
- `CredentialLookup` already takes the owner. The environment half ignores it on
  purpose, and that comment is the one to rewrite.
- Plan values are also a check constraint. `apify`, `draft_reply` and `key_test`
  each shipped as an array value with no migration, a full suite passed, and the
  write failed after the money was spent.
- Read docs/secrets.md, *Whose key is it*, and docs/billing.md before starting.
  Both describe the current rule as instance-wide and both change here.
- The price variable is optional, unlike the four in `requiredBillingVariables`.
  A missing one means the plan is not offered, which is visible on the screen —
  not the quiet failure that list exists for.
- The trial: a person reaches keys-included by opening Checkout on that price,
  which asks for a card and does not charge until the seven days end. So a trial
  is bring-your-own-keys until somebody pays, and the card is the first control
  on our spend. The cap in US-129 is the second.
- **Build the backend, then stop.** The plan column, the webhook, the three
  seams and the scheduler are one session. The screens are the next one, and
  they are reviewed before they are started.
- BUG-019 was the monitor form reading `process.env` where US-081 says it may
  not. It is fixed and closed, so this ticket rewrites one rule with every
  reader of it already counted.

## Log

- 2026-09-12T12:10+08:00 — Written. The owner asked for a plan where nobody
  enters a provider or model key, and chose two prices beside each other over
  replacing the current one, and a separate ticket for the cap.

- 2026-09-12T15:40+08:00 — **The backend is built.** 2,094 tests pass, lint and
  typecheck are clean. The screens are not started, which is where this stops by
  agreement.

  **What the change actually is.** `machineKeysUsable(signup)` was one decision
  asked once per composition root; it is now `machineKeysUsableFor(signup,
  plan)` and a composition root builds one `accountKeys` object and asks it per
  request and per job. Everything under it is unchanged: each layer is still
  handed an environment that is simply right and still learns nothing about why.
  `billing/plan.ts` is the new file and it holds one rule — every unknown is
  `own_keys`.

  **The reads were counted.** Four in the API: connections, pricing, the monitor
  routes and the Models screen. Two in the worker: the credential lookup and the
  model-client cache. Each has its own case. Reverting
  `machineKeysUsableFor` to ignore the plan turns **nine tests red across seven
  files** — every screen, the worker, and the rule itself. Reverting the cache
  key, the price mapping and the webhook's write each turn their own red. That
  is the evidence that these are tests and not decoration.

  **Two things were extracted so the wiring could be asserted rather than read.**
  `credentialsForAccounts` in the worker, because BUG-019 was exactly a
  composition root handing the right rule the wrong environment and it passed a
  full suite. And `planKeyedCache`, which is the money claim in the worker: the
  plan is read on every call and is part of the cache key, so an account that
  leaves the plan stops spending our model key on the next job rather than at
  the next restart. A *key* changed on the screen still needs a restart, which
  is unchanged and still in docs/secrets.md.

  **One acceptance box was rewritten and the reason is a mistake in the
  ticket.** It read *the scheduler does not return a monitor whose owner is not
  entitled*, which is US-072's rule and has nothing to do with the plan: the
  plan decides whose keys a poll spends, not whether the poll happens. Nothing
  was weakened — the box now says every rule that reads the database is asserted
  against real Postgres, which is what `plan.test.ts`, `credentials.test.ts` and
  `runtime.test.ts` do.

  **`priceId` was added to the stored Stripe state for one reason: the log.** A
  price neither variable names is read as `own_keys`, which is safe and silent,
  and an operator who mistyped `STRIPE_PRICE_ID_KEYS_INCLUDED` would otherwise
  see paying accounts on the cheaper plan and no error anywhere.

  **The documents that stated the old rule were changed in the same commit.**
  `backlog/README.md` and PLAN.md both said bring-your-own-keys is the product
  and not a fallback; both now say it is the product for the self-hosted build
  and what the hosted one sells beside it. docs/secrets.md, docs/billing.md and
  docs/accounts.md carry the new rule, and `.env.example`'s note under
  `AUTH_SIGNUP` was stale since US-081 — it still told a reader to empty their
  keys before opening signup.

  **Unproven, and it is most of what matters.** No instance has run with
  `AUTH_SIGNUP=open`, `BILLING_MODE=stripe` and a real subscription on the
  second price. Nothing has polled a real provider on this path, no Stripe
  webhook has carried the keys-included price, and no browser has rendered any
  of it. The suite covers our half: the rule, the four readers, the two worker
  seams, the webhook's write and the price mapping. What a live run would show
  is the half that is somebody else's — that Stripe's subscription item carries
  the price id where `priceIdOf` looks for it.

  **Next, in order.** US-129, the cap, before the price is offered anywhere. The
  billing screen saying which plan an account is on. The connections and Models
  screens already read the API's answer, so they say "set in the environment"
  for a keys-included account without a change — which is worth looking at in a
  browser before believing.

