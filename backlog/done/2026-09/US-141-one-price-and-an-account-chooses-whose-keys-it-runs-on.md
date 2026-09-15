---
id: US-141
title: One price, and an account chooses whose keys it runs on
type: feature
priority: p1
created: 2026-09-15T23:40+08:00
parent: US-128
area:
resolution: shipped
---

## Context

**The mode was built as a Stripe price and it is not one.** US-128 gave
`subscriptions.plan` two values and had the webhook write it from the price a
subscription names, so "own keys" and "keys included" were two prices on two
products. US-134 then decided one price with two modes, and nothing moved the
mode off the price — so the product still sells two.

A price cannot express what the owner wants. Switching modes would be a
subscription change, and *remove my key at three o'clock* cannot wait for a
webhook. **The mode is a fact about the account, and it is the account's to
change at any moment.**

**One price: $35.** Everybody who subscribes is on it. `subscriptions.plan`
stops deciding anything, `STRIPE_PRICE_ID_KEYS_INCLUDED` is unset, and
`planForPrice` has nothing left to map.

**Their keys or ours, and never a mix.** The owner was asked and said so
plainly. So it is one account-level state and not an inference from which keys
happen to exist: inferring it means pasting one Reddit key silently changes
what happens to X, and a key that is stored and then ignored is the thing this
product refuses to do everywhere else — `credentials.ts` and docs/secrets.md
both turn on a stored key being obeyed.

**On their keys there is no limit at all.** The money is theirs, US-013's
per-monitor budget is the control, and every dial US-133 added is off. On ours
the capacity applies exactly as US-133 and US-134 built it, because it was
sized against what those platforms cost us.

**A monitor whose keys are missing does not run, and the form says which.**
That is `startBlockers`, unchanged since US-085. It is also what makes "no mix"
a rule rather than an accident: choose your own keys and every platform you
watch needs one of yours.

**US-132 is reversed, on the owner's instruction.** Its 403 gate and both
precedence flips were built for a plan where the deployment held every choice.
The account holds the choice now, so a key it pastes must win — which is
`credentials.ts`'s ordinary order and US-130's original wording, before US-132
amended it. What US-132 was written to stop is still real: a subscriber can
point our model key at the dearest model a provider sells. US-129's cap is what
bounds that now, and it did not exist when that ticket was written.

**The fuse counts the wrong money today.** `api_usage` and `model_calls` record
what a call cost and not whose key paid, so an account on its own keys would
spend its own money against our $25 fuse and be stopped for the month over
money we never spent. Both ledgers need to say whose key it was.

## Acceptance

- [x] One price. `STRIPE_PRICE_ID` is the $35 price, the keys-included price is
      gone from the settings and the environment, and `subscriptions.plan` is
      dropped — column, enum, webhook write and all
- [x] An account carries one state in `account_key_source`: `own` or
      `instance`, and no row means this instance's. A new account is on that
      from the moment it registers — US-140
- [x] The state is the account's to change at any time, from the connections
      screen, and it takes effect on the next poll: every reader asks per
      request and per job, and the worker's model cache is keyed by it
- [x] On its own keys: no capacity at all, and every control it has today
- [x] On ours: the capacity US-133 enforces and US-134 sized, and the same
      controls — a key it pastes is stored and obeyed, because US-132's
      refusals are reversed
- [x] There is no mix: the state is one value, not an inference from which
      keys exist. A platform an account holds no key for does not run, and
      `startBlockers` names the key, as it did before
- [x] A stored key always wins over the environment, and so do the model rows.
      `credentials.ts`'s documented order, restored
- [x] `api_usage.key_source` and `model_calls.key_source`, with migration
      `0063` named in the journal. Stamped where the row is written rather
      than by thirteen callers, because a rule applied to twelve of them is
      BUG-009 again
- [x] The account cap counts only `key_source = 'instance'`, in the
      per-account read and the scheduler's batch read. An account on its own
      keys meets no cap of ours
- [x] The connections screen carries the switch and says what each choice
      costs; the Models screen says which state the account is in and points
      at the one control. Both keep every control they had
- [x] With signup closed nothing changes. And an open instance that does not
      charge lends nothing — US-081's rule, composed in `accountKeys`, and the
      one thing the account cannot choose
- [x] Every rule that reads the database is asserted against real Postgres
- [x] No test reaches Stripe, a provider or a model. 2,245 pass

## Notes

- **The state needs a home, and `users` is not it** — Better Auth owns that
  table. A one-row-per-account table beside `user_onboarding` is the shape,
  or a column on `subscriptions`; the second is wrong for the reason this
  ticket exists, so it is the first.
- `config/machine-keys.ts` holds the rule and keeps holding it.
  `machineKeysUsableFor(signup, plan)` becomes a question about the account's
  state rather than its plan, and `spendsInstanceMoney` with it. Do not add a
  second rule beside them.
- The capacity is already keyed off `accountKeys.capacity`, so it moves with
  the rule and needs no change of its own. US-133 and US-134 stand.
- Reversing US-132 is deleting `apps/api/src/lent-keys.ts` and its test,
  restoring `credentialsForAccounts` and `readAiEnvironmentFor`, and giving
  both screens their controls back. Its ticket records the reversal and why.
- US-140 is the trial, and it now means: a new account starts subscribed-by-
  trial on this instance's keys, with the trial capacity, and skips the
  two-step gate because it needs no keys to start.

## Log

- 2026-09-15T23:40+08:00 — Written after the owner corrected the shape twice in
  one sitting: first that a lent-keys account must still be able to paste its
  own keys, then that there is one price and no mix. The second correction is
  the one that matters — the mode was a Stripe price and it had to become a
  fact about the account.

- 2026-09-16T01:30+08:00 — **Built, and it reverses two tickets of my own from
  earlier today.** US-132's 403 gate and both its precedence flips are gone,
  and US-130's original wording is back: a recorded choice wins and the
  deployment's answer is the default under it.

  Two things were found while building that the ticket had not predicted.

  **The fuse counted the wrong money.** Neither ledger recorded whose key paid,
  so an account on its own keys would have been stopped for the month over
  spending we never did. Both tables carry `key_source` now, and the sum that
  feeds the cap reads only our half.

  **The default direction had to flip, and that reopened US-081's hole.** Under
  US-128 an unknown meant *not ours*, because the plan arrived from Stripe and
  a missing webhook must not hand out keys. No row means *ours* now, because
  the state is the account's own. That is right for an instance that charges
  and wrong for one that does not: signup open with `BILLING_MODE=off` would
  have handed the owner's keys to every stranger. `accountKeys` composes the
  two, and a test pins it.

  `live:stripe-plan` was deleted. It subscribed two customers to two prices and
  read back the plan the webhook wrote, which is a thing that no longer exists.
  docs/instruments.md says so rather than leaving a gap.
