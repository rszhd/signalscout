---
id: BUG-014
title: The billing screen names a price nobody charges
type: bug
priority: p1
created: 2026-09-10T04:05+08:00
parent: US-072
area: billing
resolution: fixed
---

## Context

`Billing.tsx` renders `$15` from a string literal. The live price created for
the cloud version on 2026-09-10 is **$20 a month**, so the screen quotes a
figure Stripe does not charge, and Checkout shows the real one on the next
page. A person reads $15, clicks Subscribe, and is asked for $20.

**The literal was right the day it was written and became wrong without being
edited.** That is `is_default_branch`'s shape from US-077 again: a value that
lives in this repository but is *decided* somewhere else. There is no edit to
this file that fixes the class — swapping `$15` for `$20` restores the bug the
next time anybody changes the price in Stripe, and nothing here would notice.

**So the number is read from Stripe rather than stated here.** `STRIPE_PRICE_ID`
already names the exact object, the billing route already makes one read per
screen load, and Stripe is the only thing that knows what a card will be
charged.

**A price that cannot be read is shown as no price.** Stripe being unreachable
must not print a number this product guessed: a wrong figure about money is
worse than a missing one, and Checkout will state it anyway. The screen says
pricing is shown at checkout and offers the same button.

**Nothing about the trial changes, because nothing about it is wrong.** The
price carries no `trial_period_days`, the seven-day clock is ours and is written
by the sign-up hook with no Stripe call, and Checkout sends `trial_end` only
while our own trial still has time left — so somebody subscribing after it
expires is charged at once. That was checked against the live price object while
this was written, and it is recorded here because the shape invites the
opposite assumption.

## Acceptance

- [x] The amount, currency and interval on the billing screen come from the
      price Stripe holds, not from a literal in this repository
- [x] The read is cached for the process, so a screen load is not a Stripe
      call every time
- [x] A price Stripe cannot answer for renders no amount and no invented one,
      and the Subscribe button still works
- [x] `off` mode still shows `$0` and makes no Stripe call, because a
      self-hosted instance registers no billing route at all
- [x] A test fails if a literal price returns to the screen

## Notes

- The currency is formatted from what Stripe returns rather than assumed to be
  dollars. The account is Malaysian; the price is USD today and the code must
  not encode that.
- Stripe returns `unit_amount` in the currency's minor unit. Dividing by 100 is
  wrong for zero-decimal currencies such as JPY, and `Intl.NumberFormat` knows
  which are which — so the amount is handed to it rather than divided by hand.

## Log

- 2026-09-10T04:05+08:00 — Reported by the owner an hour after the cloud
  version went live, from the running screen.
- 2026-09-10T04:20+08:00 — `BillingProvider.readPrice` reads the price object
  `STRIPE_PRICE_ID` names, the billing state carries it, and the screen formats
  it. 1,785 tests pass.

  **Only a successful read is cached.** Caching the failure would leave the
  screen priceless until somebody restarted the process, which is a worse
  outage than the one it is recovering from. A deliberate mutation that caches
  the failure turns the suite red.

  **The amount crosses the wire in the currency's minor unit, undivided.**
  Dividing in the route would be wrong for JPY and KRW, which have no minor
  unit, so the scaling lives on the screen beside the formatter that needs it.
  Stripe's zero-decimal list is encoded there because the browser has no such
  lookup: `Intl` formats a scaled number correctly but cannot supply the scale.
  Mutating that list to divide everything turns the suite red — 2000 JPY is
  ¥2,000 and the mutation quotes ¥20.

  **A tiered price throws rather than rendering zero.** `unit_amount` is null on
  a usage-based price, and `?? 0` would have told somebody this product is free.

  Three mutations were confirmed red: a literal returning to the screen, the
  currency scale flattened, and the failed read cached.

  Nothing here has been seen against the live price by a person. The value it
  will show is $20, from `price_1UDqkFBIfSMgofvW8a91VveP`.
