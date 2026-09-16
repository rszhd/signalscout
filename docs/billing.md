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

## Two plans, and the second one includes the keys

US-128, rekeyed by US-141. **One price, and two ways to run it.** Bring your
own provider and model keys and there is no limit on what you build, because
the money is yours. Run on this instance's keys and the plan carries a
capacity, because the money is ours.

**It is the account's own state, not a property of what it bought.** US-128
made it a second Stripe price and had the webhook write `subscriptions.plan`;
US-141 removed that column. A price cannot express a choice somebody changes at
three o'clock, and a webhook is not how a key starts being used — so
`account_key_source` holds one row per account, and the connections screen is
where it is changed. It takes effect on the next poll, with no restart.

**One state, and never a mix.** An account runs on its own keys or on this
instance's. A platform it holds no key for does not run rather than falling
back to ours: `startBlockers` names the key on the monitor form, before
anything starts. Inferring the state from which keys happen to exist was the
alternative, and it fails twice over — pasting one Reddit key would silently
change what happens to X, and a key stored and then ignored is what
`credentials.ts` exists to prevent.

No row means this instance's keys, which is what a new account is. Note the
direction is the opposite of US-128's, and deliberately: there an unknown had
to be *not ours* because the plan arrived from Stripe and a missing webhook
must not hand out keys; here the state is the account's own, and the product's
answer to somebody who has chosen nothing is that we run it. One thing the
account cannot choose: an instance with signup open and `BILLING_MODE=off`
lends nothing, so an account there is on its own keys whatever the row says.
That is US-081's rule, and `accountKeys` is where it is composed.

`billing/key-source.ts` holds the state and `config/machine-keys.ts` holds
what it then means.

**The plan sells a capacity, not an allowance.** US-133 and US-134. One
project, one monitor, six queries with at most three on LinkedIn, every
platform, and an interval per platform: LinkedIn daily, Instagram every twelve
hours, the other four every four hours. No comment threads. The trial is
smaller — four queries, daily, and neither Instagram nor LinkedIn. Every
number is a variable under `KEYS_INCLUDED_`, read at boot, with those figures
as the defaults.

**A monitor belongs to the keys it was made on.** US-150. `monitors.key_source`
is stamped from the account's state when the monitor is made and never
rewritten. Where the deployment charges, an account on its own keys does not
run a monitor made on the instance's, nor the reverse: the scheduler leaves it
out, a poll that reaches it is refused with `other_keys`, the list shows "On
other keys", and the page says where to switch. A monitor made on the
account's own keys fills no slot of the plan's capacity. A self-hosted
instance has no switch and checks nothing. The migration stamped every
existing monitor with its account's state at the time, which is the best a
migration can know.

**A trial may make three projects in total, deleted ones counted.** US-146.
Deleting a project takes its monitor, which frees the trial's one slot, and a
new monitor polls at the next tick — so create-and-delete was a way to poll on
the instance's keys as often as one liked. The count is read from
`project_creations`, a ledger nothing deletes from, and the fourth is refused
with the total. The plan has no such count: what bounds a paying account is
the fuse, and since US-146 `api_usage.monitor_id` is not a foreign key, so a
row outlives its monitor and deleting and re-creating does not reset what the
fuse has counted.

It is enforced in three places and the third is the one that matters. A write
past it is refused with the number — monitor create and update, and project
create. The scheduler does not send a poll for a monitor polling faster than
its plan sells. And the poll itself skips each platform whose turn has not
come round, before anything is fetched, recording `platform_not_due`.

**The plan lends a month, and `ACCOUNT_MONTHLY_CAP_MICROS` is how much.**
US-129. $15 unless a deployment says otherwise, counted across every provider
call and every model call the account caused, and reset by the calendar. No
screen and no route raises it: a monitor's own budget is the customer's and they
raise it, and this one is the deployment's. Both apply, and the lower stops the
poll. docs/costs.md, *The second cap*, holds the table.

It is enforced in three places, and the third is the one that matters. A poll is
refused in `collect.ts`; a batch of classifications stops mid-way through the
spend meter; and the scheduler does not queue a poll for an account that has
spent its month — which is what stops the work being started at all, the same
half of the gate `entitledCondition` is.

**The plan's provider per platform is the deployment's, named in
`KEYS_INCLUDED_PROVIDER_<PLATFORM>`.** US-130. An account on our keys never
pastes a key, so nothing records it a choice, and with two keys on the
instance for one platform the poll would refuse. So `accountKeys(...).choices`
answers such an account with what the deployment named — and only that: a row
the account recorded before the plan is left in place and not read, and
reading it again is what leaving the plan does. An account spending its own
keys reads its rows, US-026's refusal untouched. Every reader of a choice — the
four worker steps, the connections screen, the pricing page and the monitor
form — is handed that function by the composition root, so the form and the
poll answer alike. A name this build cannot run stops both roots at boot.

**Checkout opens on the one price this deployment sells, and US-131 is what
puts a button in front of it.** There is nothing to choose there any more:
whose keys an account runs on is a switch on the connections screen, not a
line item.

One consequence is worth stating rather than discovering. `past_due` is
entitled, so a card that failed this morning keeps polling on our keys while
Stripe retries. That is US-072's judgement about entitlement, applied here
rather than argued again.

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

ACCOUNT_MONTHLY_CAP_MICROS=25000000     # optional: the deployment's fuse, $25
KEYS_INCLUDED_QUERIES=6                 # optional: what the plan sells, per dial
KEYS_INCLUDED_PROVIDER_REDDIT=scrapecreators   # one per platform: who fetches it on that plan
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
