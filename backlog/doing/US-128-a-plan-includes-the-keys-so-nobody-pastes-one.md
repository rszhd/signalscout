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

- 2026-09-13T10:20+08:00 — **It has run live, on a real provider.**
  `live:lent-keys` is the instrument, and it is new: nothing that existed could
  ask this question, because every other live script builds its lookup from
  `process.env` directly and so never meets the plan at all.

  One scratch database, two accounts on the same open instance, and the real
  `accountKeys`, the real `credentialsForAccounts` and the real collect step.
  The whole run cost **$0.0038** — one ScrapeCreators YouTube request — because
  the other three steps are refusals, and a refusal is free.

  | | plan lends the keys | spends its own |
  |---|---|---|
  | `api_usage` rows | 1 | 0 |
  | `model_calls` rows | 39 | 0 |
  | spent | $0.0038 | $0.0000 |
  | posts stored | 39 | — |

  **The claim both tickets rested on is measured.** One instance, one
  `SCRAPECREATORS_API_KEY`, two accounts, two answers: the plan account polled
  YouTube and was billed 2 units against its own ledger rows, and the account
  beside it reached no provider and spent nothing.

  **The cap stopped a poll and the scheduler stopped a tick.** With nothing lent,
  the same account's spend was $0.0038 before the poll and $0.0038 after it, so
  no provider was reached. `enqueueDuePolls` then found 2 monitors due and sent
  1: the plan account's was held back and the other account's was not.

  **`model_calls.user_id` is written on real calls.** 39 rows against the plan
  account and none against the other, which is migration 0060 working end to
  end rather than in a fixture.

  **The model half is still unmeasured, and the reason is not ours.** This
  machine's `AI_API_KEY` is an OpenAI key with no credits: every one of the 39
  classifications came back *You have no credits remaining*. So the spend meter
  stopping a batch at the account cap has been asserted and not measured. It
  needs a funded key and one more run of the same script, which would cost the
  same $0.004 plus the classifications.

  Two earlier runs of this script cost $0.0038 each and measured less: the first
  died because the script did not catch the classify step's throw the way
  `live-poll.ts` does, and the second reported `due: 0` because both monitors had
  polled a moment before and their own interval, not the cap, was keeping them
  out. Both are fixed in the script.

- 2026-09-13T11:05+08:00 — **The model half is measured too, on DeepSeek.**
  The earlier run could not reach it: this machine's OpenAI key has no credits.
  DeepSeek's is in the machine environment rather than `.env`, which is why the
  first attempt reported no key.

  **`live:model-probe --provider=deepseek --model=deepseek-flash` first**, for a
  fraction of a cent, because docs/instruments.md warns that a provider speaking
  the OpenAI wire format is not by that fact one that speaks structured output.
  It answers: `status: ok`, 149 in, 25 out, 0.9s. The AI SDK warns that
  `responseFormat` is unsupported and puts the schema in the prompt instead —
  and the answer still comes back usable. US-124 asked that question and this is
  the answer for `deepseek-flash`.

  **Then the run, with a cap set to $0.0060 — just above what the provider half
  costs — so the classifier had to cross it.**

  | | measured |
  |---|---|
  | posts collected and stored | 38 |
  | posts sent to the classifier | 38 |
  | **model calls actually made** | **5** |
  | provider spend | $0.0038 |
  | model spend | $0.0027 |
  | total against the cap of $0.0060 | $0.0065 |

  **The spend meter stopped a batch of 38 after 5 calls.** Uncapped, those 38
  calls would have been about $0.0205. That is US-129's model half, which the
  suite asserts and nothing had measured: a batch is where an account's lent
  month actually goes, and the meter stops it partway rather than at the next
  poll.

  The $0.0005 overshoot past the cap is the documented one. The meter subtracts
  what the loop reports between readings and stops when the next call would
  cross, so the call that crosses is paid for — the same "up to one poll"
  property docs/costs.md records for the monitor guard, one call at a time
  instead.

  **The price was stated, not read.** This repository holds no DeepSeek price
  row on purpose: US-124 read the page and found four bands, $0.003 to $0.30 per
  million input tokens on `deepseek-flash`, with nothing in the usage saying
  which tokens were cached. This run set `AI_INPUT_PRICE_MICROS` and
  `AI_OUTPUT_PRICE_MICROS` to 300000 — the dearest input band, used for output
  as well because no read output figure exists here. So the *figures* above are
  a deployment's stated price and not DeepSeek's invoice. What is measured is
  the mechanism: priced model calls accumulate into the account's month, and the
  meter stops the batch when it is gone. That claim does not depend on the price
  being right.

- 2026-09-13T11:40+08:00 — **The Stripe half has run, end to end, in test mode.**
  `live:stripe-plan` is the instrument, and it is the first one that does not
  live in `packages/core`: it needs the Fastify server, so it is
  `pnpm --filter @signalscout/api live:stripe-plan`. A first attempt put it in
  core and broke the one architectural rule in the repository — `tsc` said so
  immediately, which is the rule working.

  A real customer, linked before the subscription the way the Checkout route
  does it. A real subscription on each price. A real webhook, delivered by
  `stripe listen` over a real signature to the real route. The rows read back
  out of a scratch database:

  | price | plan the webhook wrote | period end |
  |---|---|---|
  | `STRIPE_PRICE_ID_KEYS_INCLUDED` | **`keys_included`** | 2026-10-13 |
  | `STRIPE_PRICE_ID` | **`own_keys`** | 2026-10-13 |

  **The claim this existed for was somebody else's half.** `priceIdOf` reads the
  price off the subscription *item*, the way `periodEndOf` reads the period end,
  and reading the wrong place answers undefined rather than an error — an
  account quietly on the cheaper plan, with nothing anywhere saying so. It reads
  the right place. The period end came back real beside it, which re-proves
  US-072's own measurement on this API version.

  **What was created in the Stripe test account, and kept.** A second product,
  `prod_VFZw2u1ZRiRVPS`, *SignalScout Cloud — keys included*, and a price on it,
  `price_1UF4mcBfLvxRNL4euPaVEDp2`, at $49.00 a month — the figure this ticket
  recorded. One product per plan, because Checkout and invoices show the
  product's name on every line and two plans sharing one product give a customer
  two lines they cannot tell apart. Both customers the run made were deleted and
  the scratch database was dropped.

  `STRIPE_PRICE_ID_KEYS_INCLUDED` is **not** in `.env` yet. Until it is, the
  instance sells one plan, which is the documented behaviour of leaving it unset
  and is the right state while Checkout still does not offer the price.

  Also worth keeping: the test-mode `STRIPE_PRICE_ID` is $15.00 a month, and the
  live one created on 2026-09-10 is $20. The two accounts do not agree, which is
  fine — BUG-014 is why no screen states either from this repository — but it
  will confuse the next person who compares a test run with a live invoice.
