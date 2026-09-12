---
id: US-129
title: An account has a monthly cap on the instance's money
type: feature
priority: p1
created: 2026-09-12T12:14+08:00
parent: US-128
area:
resolution:
---

## Context

**US-128 lets an account spend our keys. Nothing limits how much.** A cap exists
today, and it is the wrong shape for this: `budgets` is one row per monitor,
optional, and set by the person who owns the monitor. On a keys-included plan
that is the customer setting the limit on our invoice.

Two facts decide how bad the worst case is. BUG-004 says the model half of a
poll is not capped at all, so even a monitor with a cap can spend past it on
classification. And docs/costs.md says an Instagram comment is the dearest item
this product fetches, and that a vague query is not free silence. One account,
one broad monitor, one dear platform, polling on a schedule, is the whole
failure — and it arrives as an invoice a month later, which is the failure mode
the budget guard was written for in the first place.

**The cap belongs to the account and to the instance, not to the monitor.** It
is a figure the deployment sets, the same way `BILLING_MODE` is, and a person
cannot raise it. The monitor's own cap stays exactly as it is and keeps meaning
what it means: what the customer chose to spend. Two caps, two owners, and the
lower one stops the poll.

**It only applies where the money is ours.** A bring-your-own-keys account is
spending its own, and a self-hosted instance is one person spending theirs — for
both of those this cap is not a limit anybody asked for. It reads the plan, and
with signup closed it does nothing.

**Both halves of a poll count, or the cap is a number about Reddit.** The
account's month is the source spend plus the model spend, which `api_usage` and
`model_calls` already record per account since BUG-009. The guard is the same
guard the poll already passes through.

**The figure is $15 a month, and the plan is sold at $49.** The owner decided
both on 2026-09-12, from what this repository has measured rather than from a
guess. The arithmetic, worst case, is $49 less $15 of spend at the cap, less
Stripe's fee and hosting: about $29, or 60%. Most accounts will not reach the
cap — the one real monitor on the production instance has spent $1.06 in total.

**The cap is $15 because spend varies about a hundred times with settings the
customer controls.** From docs/costs.md and docs/history.md: one Reddit monitor
polled hourly through SocialCrawl costs about $27 a month, measured at 67
credits over 15 polls; the same monitor on Bright Data costs $55 to $275,
because a record there is five times dearer per post; the same monitor polled
every four hours costs about $7; polled daily, about $1. The model adds roughly
half as much again. One Instagram poll with comments spent $1.63 on its own.

**So two defaults have to change with the price, or the cap bites in days.**
They are part of this ticket rather than a later one, because a plan sold at $49
whose default configuration costs $40 is not a plan.

* **A keys-included account does not default to hourly.** Every four hours costs
  about a quarter as much, and three monitors then fit inside the cap. This
  product finds threads people will still be reading next month; it is not
  breaking news, and `defaultPollIntervalSeconds` was chosen before anybody was
  paying for the polls.
* **Instagram comments start off on this plan.** One poll is $1.63. Ten of them
  spend the whole month.

**A flat price with a hard cap was chosen over metered billing.** Metered would
be more honest and would scale, and it is a much larger piece of work — and it
puts a moving number in front of somebody who bought this plan to stop thinking
about provider bills. One number, and it cannot surprise anybody.

**What the figure rests on, and where it is soft.** Our spend number is an
estimate and the provider's invoice is authoritative. It has been compared with
a provider dashboard once, on one day, and read 3.2% high — high is the safe
direction for a cap, and one day is not a reconciliation. Bright Data's free
5,000 records a month are not modelled, so early spend reads higher than it is.
And a provider can raise a price without telling the code. Revisit the $15 after
the first month of real accounts, not before.

## Acceptance

- [ ] One figure in `.env` sets the monthly cap for a keys-included account, and
      the deployment sets it. No screen and no route raises it. It defaults to
      $15, the figure the price was set from
- [ ] The cap counts source spend and model spend together, per account, per
      calendar month, on the month `monthStart` already defines
- [ ] A poll that would cross either the monitor's cap or the account's is
      refused, and the sentence says which one stopped it
- [ ] The account's cap is not applied to a bring-your-own-keys account, nor
      anywhere signup is closed
- [ ] The billing screen shows the account's cap and what is left of it
- [ ] Reaching the cap does not lose collection already paid for, and does not
      delete anything. Reads stay, the way the paywall's do
- [ ] Asserted against real Postgres, with the money already recorded, and the
      scheduler half asserted separately from the route half
- [ ] A monitor created by a keys-included account polls every four hours rather
      than hourly, and a person may still choose either
- [ ] A keys-included account's new monitor starts with Instagram comments off
- [ ] The billing screen states the plan's price and its cap in one place, read
      from Stripe and from the setting rather than written in the markup
- [ ] No test spends money

## Notes

- `packages/core/src/budget/budget.ts` holds the guard, `monthStart`, and
  `spendByPair(db, userId)` — the account-wide sum is already one query away.
- Read docs/costs.md, *The cap*, before starting. The overshoot by up to one
  poll is a property of the existing design, and this cap inherits it.
- BUG-004 is the model half being uncapped. This ticket does not need it closed,
  but the account cap is worth much less until it is, and the two touch the same
  guard.
- US-128 must not offer its price in Checkout until this closes.
- The price itself lives in Stripe, not here. BUG-014 is why: a figure written in
  this repository is a copy that goes stale in silence. $49 is recorded in this
  ticket as the decision it was, and `STRIPE_PRICE_ID_KEYS_INCLUDED` is what a
  card is charged.
- `defaultPollIntervalSeconds` is 3,600 in `schema.ts` and is a column default,
  so the plan's slower default belongs where the monitor is created and not in
  the schema. Changing the column would change it for every self-hosted instance
  as well, which is somebody else's machine and somebody else's money.

## Log

- 2026-09-12T12:14+08:00 — Written, split from US-128 on the owner's decision:
  build the key sharing first, keep the plan off the price list until the money
  is bounded.

- 2026-09-12T16:05+08:00 — The price and the cap were decided: $49 a month
  including $15 of spend. The figures come from the measurements already in
  docs/costs.md and docs/history.md, listed in the Context above so the next
  reader can disagree with the arithmetic rather than with the conclusion. Two
  defaults joined the scope at the same time, because the price does not work
  without them.
