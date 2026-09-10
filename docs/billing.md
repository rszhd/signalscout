# Billing

**This is off by default, and the self-hosted instance never meets any of it.**
`BILLING_MODE` is `off` unless a deployment says otherwise: no trial, no
paywall, no payment provider, and every screen behaves exactly as it did before
this existed.

The hosted version is $20 USD per month, after seven free days that ask for no
card. **Stripe holds that number, not this repository.** The price object
`STRIPE_PRICE_ID` names is what a card is charged, the billing screen reads it
per BUG-014, and a figure written here or on the landing page is a copy that
goes stale in silence. This document says how that works, what it refuses, and
what to set up.

---

## The trial is a clock we own

Sign-up writes one `subscriptions` row — `trialing`, with a deadline seven days
out — and makes **no network call**. There is nothing for Stripe to hold while
nobody has given a card, and registration must not be able to fail because a
payment provider is slow.

A Stripe customer is created the first time somebody opens Checkout, and not
before. So an account that signs up and never comes back leaves no object in
Stripe at all.

The other shape was considered and refused: a Stripe subscription created at
sign-up with `trial_period_days` and `missing_payment_method: pause`. It makes
registration depend on Stripe being reachable, and it creates a customer and a
subscription for everybody who ever tries the product.

**Paying during the trial does not shorten it.** Checkout is handed the trial's
own deadline, so somebody who subscribes on day two is still not charged until
day seven. Stripe refuses a trial ending less than 48 hours out, so a person
paying on the last afternoon starts their subscription immediately — which is
what pressing the button means.

---

## What the paywall refuses

**Reads stay, writes stop.** An account whose trial ran out can sign in, read
the inbox, export the CSV and pay. It cannot create a monitor, run a cost test
or draft a reply.

The rule is the HTTP method rather than a list of paths: every route that
changes something is a `POST`, `PUT`, `PATCH` or `DELETE`, so the rule covers
the route nobody remembers to add to a list. `apps/api/src/billing.test.ts`
walks every route the build registers and checks each one, which makes it a
claim about all of them rather than about the ones somebody thought of.

A refused write answers **402** with `x-billing-reason`. Not 403: "you may not
do this" and "this account has not paid" send a person to two different places.
The reason travels in a header because a route's own error schema strips a body
key it does not name, and only some routes declare one.

Two paths stay open to an unpaid account — opening Checkout and opening the
portal. Without them the paywall could not be paid.

**The half that costs money is the scheduler.** A route that refuses is what a
person sees; `findDueMonitors` not returning an unentitled owner's monitors is
what stops our hosting, our database and our compute being spent on an account
that stopped paying. That one is invisible from every screen, which is why it
has its own tests in `worker/schedule.test.ts`.

---

## Who is entitled

One rule, in `packages/core/src/billing/entitlement.ts`, written twice in the
same file: once for a row already read, and once as SQL for the scheduler's
query. `entitlement.test.ts` drives both over the same cases, because the only
thing worth asserting is that they agree.

| Stored status | May write and poll? |
|---|---|
| no row at all | **yes** |
| `trialing`, deadline ahead | yes |
| `trialing`, deadline passed | no |
| `active` | yes |
| `past_due` | **yes** |
| `canceled` | no |
| `incomplete` | no |

Two of those rows are decisions rather than bookkeeping.

**No row means entitled.** It reads backwards until you count the two ways it
happens: a self-hosted instance never writes here, and a hosted one has accounts
older than the table — the owner's own among them. Neither is somebody who
stopped paying, and a migration that silently locked the owner out of the
instance running the product is not a state anybody should be able to reach.

**`past_due` means entitled.** A card that failed this morning is a person
Stripe is still retrying, and stopping their monitors before the retries finish
throws away collection they paid for. `canceled` is where Stripe gave up, and
that is the line.

There is no `trial_expired` status. An expired trial is `trialing` with a
deadline in the past, which the clock already knows — a status meaning the same
thing would need a job to write it, and until that job ran the row and the clock
would disagree about who may poll.

---

## Setting it up

Four variables, and naming the mode makes all of them required. The process
refuses to boot without them, and that check exists for the **quiet** failure:
an instance with billing half-configured runs the whole product, every screen
works, every trial runs out, and nobody is ever asked to pay.

```
BILLING_MODE=stripe
STRIPE_SECRET_KEY=sk_…
STRIPE_PRICE_ID=price_…        # the price, not the product
STRIPE_WEBHOOK_SECRET=whsec_…
APP_URL=https://app.example.com
```

`APP_URL` is where Stripe returns a person to. It is not derived from a request
header: a return address built from something the caller controls is a return
address the caller chooses.

Make the product and its monthly price once, in the dashboard or through the
API. One product per plan — Checkout and invoices show the product's name on
every line, so two plans sharing one product give a customer two lines they
cannot tell apart.

### The webhook

The endpoint is `<APP_URL>/api/billing/webhook`, and it is the whole
integration rather than an extra. A renewal succeeds a month later, a card
fails in March, somebody cancels from the portal: none of that passes through a
browser we control, so a success page cannot be where the subscription is
recorded.

Subscribe it to `customer.subscription.created`, `.updated`, `.deleted`,
`invoice.paid` and `invoice.payment_failed`.

Locally, run the CLI beside `pnpm dev` and use the secret it prints:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

The route is one of four that answer without a session, and it is the only one
added since the login shipped. Stripe has no cookie and never will. **The
signature is the gate**: an unverified body is answered 400 and changes nothing,
which is a stronger check than a session rather than a weaker one.

An event this product does not act on is answered **200**. A non-2xx makes
Stripe retry the same event for days over something we deliberately ignore.

---

## What is not built

**Tax.** A US or EU subscription eventually needs Stripe Tax and an active
registration, and Stripe calculates and collects nothing — and reports no error
— until that registration exists. Turning on `automatic_tax` without one is the
most common mistake in this area, so nothing here turns it on.

**A Stripe key is not tested before it is stored**, unlike a provider key. It
is read from the environment rather than pasted on a screen, so the boot check
is where a wrong one is found.

**Dunning emails.** Stripe's own retry and reminder settings do this, and
building a second one here would send a person two different accounts of the
same failed payment.
