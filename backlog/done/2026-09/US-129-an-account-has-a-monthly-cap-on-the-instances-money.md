---
id: US-129
title: An account has a monthly cap on the instance's money
type: feature
priority: p1
created: 2026-09-12T12:14+08:00
parent: US-128
area:
resolution: shipped
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

- [x] One figure in `.env` sets the monthly cap for a keys-included account, and
      the deployment sets it. No screen and no route raises it. It defaults to
      $15, the figure the price was set from
- [x] The cap counts source spend and model spend together, per account, per
      calendar month, on the month `monthStart` already defines
- [x] A poll that would cross either the monitor's cap or the account's is
      refused, and the sentence says which one stopped it
- [x] The account's cap is not applied to a bring-your-own-keys account, nor
      anywhere signup is closed
- [x] The billing screen shows the account's cap and what is left of it
- [x] Reaching the cap does not lose collection already paid for, and does not
      delete anything. Reads stay, the way the paywall's do
- [x] Asserted against real Postgres, with the money already recorded, and the
      scheduler half asserted separately from the route half
- [x] A monitor created by a keys-included account polls every four hours rather
      than hourly, and a person may still choose either
- [x] A keys-included account's new monitor starts with Instagram comments off
- [x] The billing screen states the plan's price and its cap in one place, read
      from Stripe and from the setting rather than written in the markup
- [x] No test spends money

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

- 2026-09-13T09:10+08:00 — **The cap is built, and the screens are not.**
  2,130 tests pass, lint and typecheck are clean.

  **`model_calls` had no `user_id`, and the cap could not be correct without
  one.** The table has only carried `monitor_id`, which was right while every
  question asked of it was about a monitor. Three of the calls it records have
  no monitor at all — writing a monitor's queries from the form, drafting a
  project, drafting a reply — and each is repeatable from a screen. Summing
  through `monitors` would have left exactly the repeatable ones uncounted,
  which is the hole a customer could drive through. Migration 0060 adds the
  column and backfills every row that has a monitor; the ones that never had one
  stay null rather than being guessed at. `recordModelCall` requires it now, so
  TypeScript named all eight call sites rather than leaving one to be found
  later.

  **Three places enforce it, and the third is the one that matters.** A poll is
  refused in `collect.ts`, before any provider is asked. A batch of
  classifications stops mid-way, through the spend meter BUG-004 built — that is
  where an account's lent month actually goes, because a batch is many more
  calls than a poll is pages. And `enqueueDuePolls` does not queue a poll for an
  account that has spent its month, which is what stops the work being started
  at all: a refusal in `collect.ts` has already been queued, claimed and
  started, and forty of those an hour until the month turns over is not a cap.

  **`account_budget_exhausted` is its own stop reason.** Migration 0061. Apart
  from `budget_exhausted` because the repair differs and the person differs: a
  monitor's budget is the customer's and they raise it, and this one resets with
  the month and nobody raises it. A screen showing one sentence for both would
  send somebody to a control that changes nothing.

  **One acceptance box needed no code.** `include_replies` has defaulted to
  false since US-020, so a new monitor already starts with comments off on every
  plan. A case was added anyway, so that a change to that default has to argue
  with this plan's arithmetic first.

  **The tests were watched to fail, in three independent paths.** Making the cap
  never apply turns seven red across four files. Emptying the scheduler's
  over-cap set and making the meter ignore the account half turns four more red
  across three. The paths are independent, which is why two mutations were
  needed rather than one.

  **Unproven, and it is the same gap US-128 left.** No account has polled a real
  provider on this instance's keys and been stopped by this. Nothing has run with
  `AUTH_SIGNUP=open`, `BILLING_MODE=stripe` and a real subscription. No browser
  has rendered the billing screen, which is why its two boxes stay open — the
  route answers the cap and what is left of it, and a screen reading that route
  is the next session.

  **docs/costs.md's price table was stale and is fixed** in the same pass:
  ScrapeCreators fetches TikTok and YouTube since US-126 and US-127, and neither
  pair was on it.

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

- 2026-09-13T12:55+08:00 — **The screen is built, and the sentence it used to
  say is the reason it needed to be.** The bottom of the billing page told every
  account *your providers bill your accounts directly* — which is a page
  describing somebody else's plan to an account that has no providers. It now
  reads from `plan`, as do the plan card, its list of what is included and the
  three definitions below it.

  The allowance itself is shaped like the trial block beside it: a label, the
  figure, a progress bar. Two things answer the same kind of question — how much
  of something is left — and a second shape for that is a second thing to learn.

  `usageLabel` keeps four decimal places for `budget/budget.ts`'s reason: ten
  Reddit records cost $0.015, and a figure rounded to cents cannot be reconciled
  against anything. It drops the zeros a whole figure does not need, so the cap
  reads `$15` and a real spend reads `$0.0038`.

  **The sentence at the cap never says "raise", and a test holds it there.**
  Nobody raises this one. A monitor's own budget is the control a person has and
  it is on the monitor; inviting somebody to raise this would send them looking
  for something that does not exist.

  Three screen cases, and all three were watched to fail: hiding the allowance
  block and pinning the two plan sentences to their old wording turns two red.
  2,134 tests pass, lint and typecheck clean.

  **Still true: no real browser has rendered it.** These are jsdom tests, which
  is how every screen in this repository is asserted, and it is the same gap
  US-072 recorded for this page.

  One thing found and left alone: `apps/web/src/index.css` fails stylelint on
  `.product-note` — `margin-top: 29px`, against the spacing scale. It predates
  this work and is nothing to do with billing.

- 2026-09-13T20:04+08:00 — **Amended by US-133, and the cap itself stands.** The
  first person to read the billing page saw a $49 plan telling them their
  included usage is $15, which is this cap — a fuse for the deployment — printed
  as a customer allowance. What that ticket changes is who the number is for: it
  stops appearing on any screen, it rises above the capacity the plan sells, and
  the plan is limited by monitors, queries and a schedule floor instead. Nothing
  here was wrong for its own purpose. It was shown to the wrong person.
