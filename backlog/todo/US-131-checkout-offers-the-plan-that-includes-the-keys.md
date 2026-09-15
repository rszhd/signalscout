---
id: US-131
title: Checkout offers the plan that includes the keys
type: feature
priority: p1
created: 2026-09-13T13:05+08:00
parent: US-128
area:
resolution:
---

## Context

**The plan is built, measured and not for sale.** US-128 wrote the column and
the rule, US-129 bounded what it may spend, and both have run live. The one
thing missing is a way to buy it: `createCheckout` puts `STRIPE_PRICE_ID` on the
line item and nothing else, and a test holds it there.

That was deliberate. The comment in `stripe.ts` says so: an account on that plan
spends this instance's providers and model, and until US-129 closed there was
nothing to stop one. US-129 has closed, so the reason is spent and the test is
now holding a door shut that should open.

**Checkout needs to know which plan is being bought.** Today the route takes no
argument, because there has only ever been one price. The obvious shape is a
plan on the request, validated against the two prices this deployment names —
and refused rather than defaulted when it names a price that is not one of them,
for `planForPrice`'s reason: a price this instance was never told about must not
be guessed into the expensive plan.

**The screen has to offer a choice, and it has none today.** The billing page
shows one plan card, and which card it shows depends on the plan the account is
already on. Somebody who has not subscribed sees the plan they are not on, with
one button. Two prices means two cards, or one card with a switch, and that is a
design question rather than a routing one — read docs/design.md before drawing
it.

**Changing plan later is not this ticket.** An account that subscribed to one
price and wants the other goes through Stripe's portal, which can do it, and the
webhook already writes whatever plan the resulting price names — US-128's live
run measured exactly that transition in both directions. Whether the portal is
configured to offer the swap is a Stripe dashboard setting, not code.

## Acceptance

- [ ] Checkout can open on either price, and which one is the caller's choice
      rather than a default
- [ ] A request naming a price this deployment does not sell is refused, not
      guessed
- [ ] A deployment that names no keys-included price offers one plan, and the
      screen shows no choice at all
- [ ] The billing screen offers both plans with their prices, both read from
      Stripe rather than written in the markup. BUG-014
- [ ] The plan an account is already on is shown as the one it is on, not as
      something to buy again
- [ ] `stripe.ts`'s comment about holding the price back is removed with the
      behaviour it describes, and the test that pins one line item is replaced
      rather than deleted
- [ ] No test reaches Stripe

## Notes

- `packages/core/src/billing/stripe.ts`, `createCheckout`, is the line item, and
  `apps/api/src/billing.ts` is the route. The price the account ends up on is
  read back from the subscription by the webhook either way, so this changes
  what is offered and not what is recorded.
- `live:stripe-plan` already subscribes to both prices and reads back the plan
  the webhook wrote. Extending it to go through the real Checkout Session is the
  obvious next step for it, and US-072 recorded why nobody has: paying through
  Checkout means typing a card into a hosted form.
- The price ids used for the live run are in US-128's Log. The test-mode
  keys-included price is $49.00 a month, and US-134 replaces it with a new price
  object at $35.00. A Stripe price cannot be edited.
- `STRIPE_PRICE_ID_KEYS_INCLUDED` is not in any `.env` yet. Nothing is for sale
  until it is, whatever this ticket builds.
- There is one lent-keys plan — US-134. So this deployment names two prices, and
  Checkout takes which of them is being bought rather than defaulting. A price it
  was never told about is refused.
- What the button says the plan is comes from US-133: monitors, queries, a
  schedule and a platform list, never a figure in dollars of included usage. Do
  not write that copy twice — Checkout, the billing page and Stripe's own
  product description all state the same capacity.

## Log

- 2026-09-13T13:05+08:00 — Written as US-128 and US-129 closed. Selling the plan
  was deliberately held back until the cap existed; it exists.

- 2026-09-15T13:43+08:00 — Corrected a note that said US-134 carries three
  plans. It carried three for 26 minutes on 2026-09-13 and has carried one
  since.
