---
id: US-133
title: The lent-keys plan sells capacity, not an allowance
type: feature
priority: p1
created: 2026-09-13T20:02+08:00
parent: US-128
area:
resolution:
---

## Context

**One number is doing two jobs, and one of them is wrong.**
`ACCOUNT_MONTHLY_CAP_MICROS` was built by US-129 as a fuse for the deployment: a
runaway account must not spend our money at 02:00 with nobody watching. The
billing screen then showed that fuse to the customer and called it "your monthly
allowance". A person paying $49 is told their plan includes $15. That is not a
plan. It is our internal limit, printed on their bill.

**A customer buys watching, not dollars.** The dials they already set on the
monitor form are the ones they understand: how many monitors, how many queries
each, how often it polls, which platforms. Those four are also what decides our
bill, so selling them costs us nothing in control — a poll is already bounded.
Bright Data Reddit fetches 50 records per query, and `maxPagesPerPoll` bounds
one poll at five pages per source. The worst case is arithmetic.

**The cost per post is a property of the provider, not the platform.** Reddit
through Bright Data is the dearest fetch this product makes, and Reddit through
ScrapeCreators is among the cheapest. The same platform, a factor of five:

| Platform | Provider | Cost per post | One query, one poll | Posts |
|---|---|---|---|---|
| TikTok | ScrapeCreators | $0.000063 | $0.0038 | 60 |
| YouTube | ScrapeCreators | $0.000094 | $0.0038 | 40 |
| X | SocialData | $0.0002 | $0.0080 | 40 |
| Reddit | ScrapeCreators | $0.00027 | $0.0038 | 14 |
| Reddit | SocialCrawl | $0.00033 | $0.0162 | 50 |
| Reddit | Bright Data | $0.0015 | $0.0750 | 50 |

**So the plan's schedule floor depends on which providers it runs through.** Two
monitors of four queries each, for one month:

| Schedule | ScrapeCreators | SocialData X | SocialCrawl Reddit | Bright Data Reddit |
|---|---|---|---|---|
| Daily | $0.90 | $1.92 | $3.89 | $18.00 |
| Every 6 hours | $3.61 | $7.68 | $15.55 | $72.00 |
| Hourly | $21.66 | $46.08 | $93.30 | $432.00 |

Bright Data is what makes an hourly plan cost more than it sells for. Take it
out of the plan and six-hourly polling costs us under $8 a month of fetching.
That is the reason the plan names its providers, which is US-130's job.

**The model half is not bounded, and it is now the larger half.** Classifying
costs about a tenth of a cent per post that reaches the model, and the pre-filter
decides how many do. It grows with the schedule: six-hourly polling draws four
times the posts. Most of them are the same posts, which deduplication drops
before the model though the provider still bills for them. Nobody has measured
what share survives the keyword stage, the similarity stage and triage, so the
figure is a range: about $2 to $5 a month on the assumptions in this ticket, and
about $12 if nothing filtered at all. The plan's worst case is therefore around
$20, of which the fetch is $8, and the margin is priced against the top.

**The fuse stays and goes quiet.** It is what stops a bug, a provider quirk or a
retry storm, and none of those are the customer's doing. So it must never appear
on a screen, and it must sit above the capacity we sold — the current default of
$15 is *below* it, which means the fuse would blow inside a plan somebody paid
for, and the person would read a sentence blaming them for spending too much.

**Nothing here touches an account spending its own keys.** They pay the provider
directly, their own per-monitor budget is the control, and US-013 owns it. A
self-hosted instance meets none of this, for US-081's reason: the money is the
operator's own.

## Acceptance

- [ ] The plan carries a capacity, and it is the deployment's configuration
      rather than a constant: how many monitors, how many queries each, the
      shortest poll interval, and which platforms are included
- [ ] The capacity is the plan's, and its numbers are US-134's. What this ticket
      owns is that a capacity exists, is configured, and is enforced
- [ ] A query limit is counted per platform and not per monitor. Six queries
      pointed at the dearest platform is the case that a per-monitor limit
      misses, and it is four times the plan's fetch
- [ ] A poll interval is per platform, not per monitor. The floor comes from the
      plan, `source_coverage` says when each source was last covered, and a
      source not yet due is skipped before anything is fetched
- [ ] The cost estimate on the monitor form prices a monitor whose platforms run
      at different rates. A quote that assumes one interval is wrong by the
      ratio between them, which is six to one for LinkedIn
- [ ] Creating a monitor past the count, with more queries than the plan
      carries, on a platform it excludes, or on a schedule tighter than its
      floor is refused with a sentence naming the plan and the number
- [ ] The refusal is checked where the monitor is written and again in the
      scheduler, so a row that got past the form is not polled anyway
- [ ] A monitor that already exists is never deleted or paused by this change.
      An account that arrives over capacity keeps what it has and may not add
- [ ] `ACCOUNT_MONTHLY_CAP_MICROS` is raised to sit above the sold capacity's
      worst case, and the reasoning is in `docs/costs.md` rather than in a
      commit message
- [ ] No screen names the cap, the allowance or a figure in dollars for a
      lent-keys account. The billing page states the capacity instead
- [ ] If the fuse does blow, the sentence the person reads does not blame them,
      and the operator gets a log line loud enough to act on
- [ ] An account spending its own keys has no capacity limit, and every write it
      makes today it makes after this
- [ ] With signup closed nothing changes
- [ ] Every rule that reads the database is asserted against real Postgres, and
      the scheduler's half has its own cases in `worker/schedule.test.ts`
- [ ] No test reaches a provider, Stripe or a model

## Notes

- The scheduler is the half that matters, exactly as it is for entitlement. A
  form refusing is what a person sees; `findDueMonitors` not returning the row
  is what stops the spend. docs/billing.md, *What the paywall refuses*, holds
  the reasoning and this follows it.
- Count the writers before writing the refusal. Monitor create and monitor
  update both set the schedule and the queries, and the queries are also written
  by the form's generator. A rule applied to two of three is BUG-009 again.
- The schedule floor is per account and not a schema constraint.
  `minimumPollIntervalSeconds` is 60 for everybody and stays, because it is
  about typos rather than about plans.
- The capacity numbers are a price decision and will change. Put them in the
  environment beside `STRIPE_PRICE_ID_KEYS_INCLUDED`, with the defaults above,
  so raising the plan does not need a release.
- `defaultAccountCapMicros` is 15,000,000 and must rise with the capacity. Twice
  the worst case is the shape: it leaves room for the model half nobody has
  measured, and it still stops a runaway.
- The billing page's sentence today is "Hosting and provider usage included, up
  to your monthly allowance." It is the one line a customer reads about this, so
  write the replacement before the code.
- US-132 refuses the choices a lent-keys account may not make. This bounds how
  much of what it did choose it may run. They are separate and neither blocks
  the other.
- US-134 carries the plan's price, its platforms and its numbers. This ticket is
  the mechanism it needs, so build this first or build both together.
- **Build the backend, then stop.** The capacity, the two refusals and the fuse
  are one session. The billing and monitor screens are the next one.

## Log

- 2026-09-13T20:02+08:00 — Written. The owner saw the billing page tell a $49
  account that its included usage is $15 and refused the shape. The arithmetic
  above is what the discussion produced: at Reddit's measured price, hourly
  polling of one monitor costs us $216 a month, so the schedule floor — not a
  dollar meter — is what a plan at this price can sell.

- 2026-09-13T20:22+08:00 — **The arithmetic above was rewritten, and the first
  version was wrong in a way worth recording.** It priced Reddit through Bright
  Data, quoted the plan at $18 of fetching a month, and concluded that daily
  polling was all $49 could buy. Bright Data bills per record at $1.50 a
  thousand; ScrapeCreators bills per request and returns seven Reddit posts for
  $0.00188. The same platform, a fifth of the price. The lesson is in the table:
  a cost per post belongs to the provider, and reading it off the platform is
  how a plan gets priced five times too high.

- 2026-09-13T20:40+08:00 — The owner asked for three plans rather than one.
  US-134 holds the tiers, the prices and the column values; the capacity in this
  ticket becomes a property of a plan rather than a single set of numbers.

- 2026-09-13T21:06+08:00 — The plan is one price at $29 with two modes, not
  three tiers. What changes here is one acceptance box: the query limit is
  counted per platform, because the platforms differ in price by a factor of
  thirteen and a per-monitor count cannot see that.

- 2026-09-14T09:14+08:00 — Two boxes added. The plan sets a poll interval per
  platform, because LinkedIn at the four-hourly rate costs more than the plan
  earns, and the form's estimate has to price a monitor whose platforms do not
  all run at the same rate.
