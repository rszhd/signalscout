---
id: US-072
title: A cloud account has seven free days, then a subscription
type: feature
priority: p1
created: 2026-09-08T14:05+08:00
parent:
area:
resolution:
---

## Context

**There is a cloud version, and nothing charges for it.** US-071's landing
page sells SignalScout Cloud at $15 USD per month — the figure this ticket was
written against. The live price created on 2026-09-10 is **$20**, and BUG-014
is where the screen stopped stating either one and read Stripe instead. US-066 opened registration.
US-067 gave each account its own provider keys. So a stranger can register on
the hosted instance today, and the product runs their monitors on our hosting
for ever, free.

**The trial asks for no card.** Seven days, then a subscription. That decides
the shape more than Stripe does: with no card there is nothing for Stripe to
hold during the trial, so the trial is a clock this application owns and not a
Stripe object. Sign-up writes one row and makes no network call. A Stripe
customer is created the first time somebody opens Checkout.

The other shape — a Stripe subscription created at sign-up with
`trial_period_days` and `missing_payment_method: pause` — was considered and
refused. It makes registration depend on Stripe being reachable, and it creates
a customer and a subscription for every person who signs up and never returns.
An outage at a payment provider must not be able to stop somebody making an
account.

**Billing is off unless a deployment turns it on.** `BILLING_MODE`, `off` by
default, which is `AUTH_SIGNUP`'s rule and for `AUTH_SIGNUP`'s reason: every
instance running today is self-hosted, and a version bump that quietly began
refusing writes on somebody's own machine is the worst upgrade this product
could ship. The self-hosted instance never meets any of this.

**The opposite mistake is quieter and it is why the boot check exists.** A
cloud instance whose `BILLING_MODE` is `stripe` but whose price or webhook
secret is missing serves the whole product free, and every screen works. So
naming the mode makes the three Stripe variables required, and the process
refuses to boot without them — the shape `AUTH_SECRET` already has.

**The gate is enforced twice, and the second one is where the money is.** A
route that refuses to write is what a person sees. The scheduler not returning
an unentitled owner's monitors is what stops our hosting, our database and our
compute being spent on an account that stopped paying. A person whose card
fails and whose monitors keep polling is the failure this ticket exists to
prevent, and it is invisible from every screen.

**When the trial ends, reads stay and writes stop.** Sign in, read the inbox,
export the CSV, pay. No new monitor, no cost test, no draft, no poll. Deleting
or hiding the data would make paying feel like a ransom and would lose the one
thing that makes somebody come back.

## Acceptance

- [x] `BILLING_MODE=off` is the default, and an instance running it behaves
      exactly as it did before this ticket — no gate, no trial row, no Stripe
- [x] `BILLING_MODE=stripe` with a missing key, price or webhook secret refuses
      to boot, with a message naming what is missing
- [x] A new account in `stripe` mode gets seven days, and no Stripe object is
      created until it opens Checkout
- [x] One rule decides entitlement, and every caller reads it rather than
      re-deriving it
- [x] A route that writes refuses without entitlement; a route that reads does
      not. The exempt list is written down and a test walks every registered
      route against it, the way the session gate is tested
- [x] The scheduler does not return a monitor whose owner is not entitled, and
      that is asserted against real Postgres
- [x] Stripe's webhook is signature-verified, and an unsigned or wrongly signed
      body changes nothing
- [x] `customer.subscription.*` and `invoice.payment_failed` move the stored
      status, so a cancellation and a failed card are both seen
- [ ] A person can subscribe, and can reach Stripe's portal to change a card or
      cancel, without this product building either screen
- [x] No test reaches Stripe

## Notes

- The Stripe client is injected, like every other seam here. No test spends
  money and no test needs the network.
- Read docs/accounts.md before changing the sign-up hook. `user.create.after`
  already claims unowned rows for the first account; the trial row is written
  in the same place, and the two must not be confused — claiming is for the
  first account only, and a trial is for every account.
- The webhook is a fourth entry on `openApiPaths`, and that file says a fourth
  should be hard. It is justified because Stripe has no cookie, and the
  signature is the gate. Say so where the list is.
- Tax is not handled. A US or EU subscription eventually needs Stripe Tax and
  an active registration, and Stripe collects nothing and reports no error
  until that registration exists. Out of scope here, and it is a ticket.

## Log

- 2026-09-08T14:05+08:00 — Written. The owner asked for billing on the cloud
  version, through Stripe, with seven free days and no card.
- 2026-09-08T16:05+08:00 — Built, and run live against Stripe in test mode. The
  suite is 1,512 tests and the whole of it passes.

  **The live run went the whole way and back.** A scratch database, the API on
  port 3001, and `stripe listen` forwarding real events. Sign-up wrote a trial
  of seven days and Stripe held **no object at all** — `GET /v1/customers`
  answered an empty list, which is the claim measured rather than argued.
  `POST /api/projects` answered 400, meaning the gate passed it to validation.

  The trial deadline was then moved one day into the past. **The same request
  answered 402 with `x-billing-reason: trial_expired`**, while `GET
  /api/matches` and `GET /api/monitors` both stayed 200 — reads keep working,
  which is the decision this ticket made about what a person keeps.
  `findDueMonitors` returned **1 due with billing off and 0 with it on**, from
  the same monitor and the same row: the half that costs money, measured.

  Opening Checkout created a real customer carrying the account id in its
  metadata, and the row was linked **before** the browser would have left.
  Subscribing that customer fired `customer.subscription.created` and
  `invoice.paid` through the real webhook; the signature verified, the row went
  to `active`, `current_period_end` came back **2026-10-08** and the seven days
  were kept beside it. The refused request then answered 400 again and the
  scheduler returned 1 due. Cancelling moved it to `canceled` within four
  seconds and the write was refused again, this time reading `canceled`.

  **The period end is the fact worth keeping.** It reads from the subscription
  *item* on this API version, not from the subscription — the old place answers
  undefined rather than an error, so getting it wrong is a renewal date that is
  silently absent. The live number proves the read.

  Two things the run did not touch. **Nobody has been through Stripe's hosted
  Checkout page**: the session was created and its URL was real, but paying
  through it means typing a card into a form, so the subscription was made
  through the API with Stripe's own `pm_card_visa` fixture instead. And **the
  portal was never opened**, for the same reason — it needs a customer with a
  live subscription and a browser.

  Test artefacts were cleaned up: the customer was deleted, the scratch database
  dropped. The product `prod_VDlHK718WCBd6A` and the price
  `price_1UDJlGBfLvxRNL4eiYgEOczW` were kept, because .env names the price.

  **One acceptance box stays open.** A person subscribing and reaching the
  portal from the screen is unproven, because no real browser has rendered the
  billing page — the same gap US-017's login has, and for the same reason.
- 2026-09-08T16:05+08:00 — Not deployed. `.env` carries the CLI's local
  signing secret from `stripe listen`. A hosted instance needs its own webhook
  endpoint at `<APP_URL>/api/billing/webhook`, and that address does not exist
  yet — US-071 recorded the same gap for `PUBLIC_APP_URL`.
- 2026-09-08T18:58+08:00 — Stripe delivered a webhook for the first time, to
  the staging instance. A test-mode endpoint was created against the SignalScout
  Cloud account for `https://app.signalscout-dev.space/api/billing/webhook`,
  subscribed to the five events `billing.ts` acts on. `stripe trigger
  invoice.paid` produced a 200 and no signature failure, and an unsigned POST to
  the same route is refused with 400.

  Two things came with it. `BILLING_MODE=stripe` could not reach a container at
  all until US-074, so this could not have been tested from the shipped
  deployment before today. And the `stripe` CLI on the development machine is
  signed in to a different account, which holds no products — every command
  about this product needs `--api-key`, and `stripe listen` without one listens
  to the wrong account and looks fine doing it.

  Still unproven: a Checkout Session, and any card.
