---
id: US-140
title: A new account starts on the trial that includes the keys
type: feature
priority: p1
created: 2026-09-15T23:05+08:00
parent: US-128
area:
resolution: shipped
---

## Context

**A person who registers today is shown two keys to paste before they can see
anything.** `startTrial` writes a row with no plan, `planOf` reads every unknown
as `own_keys` — US-128's rule and the right default — so a new account spends
its own money, holds no keys, and meets US-088's gate: connect a data provider,
add a model key, and only then the product. Two accounts to open at two
companies before a single conversation is collected.

That was the only honest shape while the instance had nothing to lend. It has
something to lend now. US-128 built the plan, US-129 the fuse, US-130 the
providers, US-132 the refusals and US-133 the capacity — and **US-134 sized the
trial for exactly this**: four queries, polled once a day, on Reddit, X, YouTube
and TikTok only, because those are the four that cannot make seven free days
cost more than the first month earns. Seven daily polls of four queries is
**$0.11 to $0.22 of fetching, about $0.30 a head with the model.** That figure
was computed for a trial nobody was on.

**So the change is one line of intent and two of code.** A new account starts on
the plan that includes the keys, for seven days, and goes straight to creating a
project. The gate that asks for keys does not apply to an account that needs
none.

**What this costs, said plainly.** `AUTH_SIGNUP=open` plus a trial on our keys
means anybody who registers can spend about $0.30 of ours before deciding
anything. `AUTH_EMAIL_VERIFICATION` is `required` on the cloud instance, so a
registration is one working address rather than one form submission, and the
trial capacity is the bound — not the fuse, which sits far above it. That is the
whole defence and it is worth naming, because US-081 exists to stop precisely
this shape when it is *unbounded*.

**The two-step page does not go away.** An account that leaves the plan, or one
on a self-hosted instance, still has to connect a provider and a model, and the
gate is still where that is said. What changes is who meets it.

## Acceptance

- [x] A new registration on an instance that charges starts a trial running on
      this instance's keys. It needs no write: no row in `account_key_source`
      means ours, which US-141 made the default
- [x] Nothing changes where `BILLING_MODE` is `off`: no trial, no state, no
      change to a self-hosted instance — and an open instance that does not
      charge lends nothing, which `accountKeys` composes
- [x] `startTrial` still never overwrites, so a paying account cannot be handed
      a fresh week
- [x] An account running on this instance's keys is not shown the two-step
      setup gate, and lands on the project screen
- [x] An account that brings its own keys meets the gate exactly as it does
      today. It is the same gate, with one more condition
- [x] The trial's capacity is the one US-134 sized: four queries, daily, on
      Reddit, X, YouTube and TikTok, read while the subscription is trialing
- [x] The billing screen says what the account's plan includes, which is
      US-133's work and unchanged here
- [x] Every rule that reads the database is asserted against real Postgres
- [x] No test reaches Stripe, a provider or a model

## Notes

- `packages/core/src/auth/auth.ts` is where the trial starts, in the hook every
  path that creates a user passes through. `billing/store.ts` holds
  `startTrial`.
- The gate is `apps/web/src/App.tsx`, and the condition it needs is the
  `lentKeys` flag the connections view already carries since US-132 — not a
  second question.
- Read [docs/billing.md](../docs/billing.md), *what the trial is*, before
  changing the entitlement half. A trial that has ended is refused by
  `entitledCondition` whatever plan it names, and that is untouched here.
- The trial capacity lives in `billing/capacity.ts` as `defaultTrialCapacity`,
  read under `KEYS_INCLUDED_TRIAL_`.

## Log

- 2026-09-15T23:05+08:00 — Written. The owner signed up on the development
  instance, met the two-step gate, and asked for a new account to start on the
  trial that includes the keys and go straight to a project.

- 2026-09-16T01:35+08:00 — **Closed, and it turned out to be two lines.**
  US-141 moved the mode off the Stripe price and made "no row" mean this
  instance's keys, so a new account is already on the trial that includes them
  and nothing has to be written for it. What this ticket adds is the gate's
  one extra condition — an account on our keys is never asked for keys — and
  the paragraph in `auth.ts` saying why the trial writes nothing.

  The cost stands as the Context stated it: about $0.30 a head, bounded by the
  trial capacity rather than by the fuse, with `AUTH_EMAIL_VERIFICATION`
  required on the cloud instance so a registration is one working address.
