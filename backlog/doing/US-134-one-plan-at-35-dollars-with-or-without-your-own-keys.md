---
id: US-134
title: One plan at $35, with or without your own keys
type: feature
priority: p1
created: 2026-09-13T20:38+08:00
parent: US-128
area:
resolution:
---

## Context

**One price, two ways to run it.** $35 a month. Bring your own provider and
model keys and there is no limit on what you build, because the money is yours.
Use this instance's keys and the plan carries a capacity: one project, one
monitor, six queries, at most three of them on LinkedIn.

This replaces the three tiers this ticket was first written with. A person
choosing between three capacities has to predict their own usage before they
have used anything, and every tier is a support conversation. One price and one
sentence is the product.

**A query costs what its platform's provider charges, and the spread is
thirteen to one.** Per query, per month, polled every four hours:

| Platform | Provider | Per query-poll | One query a month |
|---|---|---|---|
| Reddit, YouTube, TikTok | ScrapeCreators | $0.0038 | $0.68 |
| X | SocialData | $0.0080 | $1.44 |
| Instagram | SocialCrawl | $0.0162 | $2.92 |
| LinkedIn | Apify | $0.0500 | $9.00 |
| LinkedIn | SocialCrawl | $0.0812 | $14.61 |

**So three LinkedIn queries polled every four hours is $27 a month, and the plan
is $35.** The query count is not what has to give. The schedule is: a B2B post
that appears on Monday is the same lead on Tuesday, and polling LinkedIn six
times a day buys almost nothing and pays for it six times.

**Each platform gets its own poll interval, and the plan sets them.**

| Platform | Interval | Polls a month | 3 queries a month |
|---|---|---|---|
| LinkedIn | daily | 30 | $4.50 |
| Instagram | every 12 hours | 60 | $2.92 |
| Reddit, X, YouTube, TikTok | every 4 hours | 180 | $2.04 to $4.32 |

The worst mix the capacity allows is about **$9 of fetching a month**, with the
model taking it to about $12 — a third of $35. Three LinkedIn queries cost $4.50
there instead of $27.

**The state this needs already exists.** `source_coverage` holds, per monitor
and per source, the moment that source is covered through. A per-platform
interval is that row compared against the interval before the source is
fetched, so this is a rule in the collect step and the scheduler rather than a
new table.

**The model half is an estimate.** About 43,000 posts are drawn a month, most of
them the same posts on the next poll. Deduplication drops those before the model
though the provider still bills for them. What share of the new ones survives
the keyword stage, the similarity stage and triage has never been measured, so
$3 is a working figure and $10 is the shape of it going wrong.

**Comments are not in any of these numbers.** A monitor that reads threads
multiplies the fetch: SocialCrawl bills five credits for a page of Instagram
replies, and `maxCommentsPerThread` is 500. The lent side needs its own answer
about comments before it is sold.

**The trial is smaller than the plan.** Four queries, polled once a day, and
neither Instagram nor LinkedIn — the two platforms that could make seven free
days cost more than the first month earns. Seven daily polls of four queries is
**$0.11 to $0.22 of fetching**, about $0.30 a head with the model, against $4
with all six platforms at four-hourly. The card at Checkout stays the first control either way,
exactly as US-128 decided.

## Acceptance

- [x] `subscriptions.plan` carries the lent-keys plan beside `own_keys` —
      US-128 did this; nothing here needed a second plan value
- [x] The plan is one Stripe price on its own product, and the webhook writes
      the plan from the price. An unknown price still reads as `own_keys`
- [x] An account on the plan may create one project and one monitor, with six
      queries in total and at most three of them on LinkedIn
- [x] The limit is counted per platform, so six queries on LinkedIn is refused
      and the refusal says which platform and what the plan allows
- [x] Each platform carries its own poll interval, set by the plan: LinkedIn
      daily, Instagram every 12 hours, the other four every 4 hours
- [x] A platform not yet due is skipped without spending, and the monitor's
      other platforms poll on their own intervals in the same run
- [x] The trial capacity is four queries, polled once a day, on Reddit, X,
      YouTube and TikTok only
- [x] An account bringing its own keys has no capacity limit at all
- [x] Every platform the lent side fetches has its provider named by the
      deployment — US-130 built it, and `.env.example` names US-134's set:
      ScrapeCreators for Reddit, YouTube and TikTok, SocialData for X,
      SocialCrawl for Instagram, Apify for LinkedIn
- [x] Reddit through Bright Data and LinkedIn through SocialCrawl are not used
      for a lent-keys account: neither is named, and a name this build cannot
      run is refused at boot
- [x] Whether the lent side reads comment threads is decided in this change:
      **it does not.** A thread page is $0.04 on Instagram and up to $0.10 on
      LinkedIn, so twenty-five threads a poll is the plan's month in a day. A
      monitor asking for replies on the plan is refused at the write
- [x] The fuse is raised to about twice the worst case and never appears on a
      screen. US-133 owns that rule
- [x] Every rule that reads the database is asserted against real Postgres
- [x] No test reaches Stripe, a provider or a model
- [ ] **The price itself is not set.** `STRIPE_PRICE_ID_KEYS_INCLUDED` still
      names the $49 test-mode price. A Stripe price is immutable, so $35 needs
      a new price object, and nothing here can make one. US-131 is where it is
      sold

## Notes

- The price is the owner's and the capacity is what defends it. The rule the
  numbers were solved for is that the goods cost about two thirds of the price
  at the ceiling, and about a third at the usage a real account produces.
- `planForPrice` maps one price and keeps doing so. Nothing here needs a second
  plan value, which is why this ticket shrank.
- `STRIPE_PRICE_ID_KEYS_INCLUDED` stays as the variable name. The test-mode
  price behind it is $49 and becomes $35 — a new price object, since a Stripe
  price is immutable.
- The per-platform interval is the largest piece of work here and it is worth
  saying why it is not optional: without it the plan's own LinkedIn allowance
  costs three quarters of the price.
- US-133 holds the mechanism: where a capacity is enforced, why the scheduler is
  the half that matters, and why no screen names a figure in dollars.
- US-131 offers the plan at Checkout, and its copy states the capacity in this
  ticket rather than a dollar allowance.
- Read docs/costs.md before changing a figure here. Every price above came from
  a connector's own `pricePerUnitMicros` and `postsPerUnit`.

## Log

- 2026-09-13T20:38+08:00 — Written as three tiers at $19, $49 and $99, differing
  by monitor count.

- 2026-09-13T21:04+08:00 — **Rewritten as one plan at $29.** The owner chose one
  price with two modes over three tiers: no limit on an account spending its own
  money, and a fixed capacity on an account spending ours. The arithmetic moved
  with it, and two conditions came out of the numbers rather than out of a
  preference — LinkedIn through Apify, and one query per platform. Without
  either, a $29 account costs $24 or $54 a month to serve.

- 2026-09-14T09:12+08:00 — **$35, three LinkedIn queries, and a schedule per
  platform.** The owner raised the price and kept the LinkedIn allowance, which
  the four-hourly schedule could not carry: three LinkedIn queries alone were
  $27 of a $35 plan. Polling each platform at its own rate is what pays for
  them, and `source_coverage` already holds the per-source state it needs. The
  trial was cut to four queries without Instagram or LinkedIn in the same
  decision.

- 2026-09-14T09:22+08:00 — The trial polls daily on every platform it allows.
  Seven days then costs about $0.30 a head rather than $2.

- 2026-09-15T20:12+08:00 — **The numbers are enforced; the price is not set.**
  Every figure in this ticket is now a default in `billing/capacity.ts` and a
  variable a deployment may change without a release. US-133 holds the
  mechanism and the reasoning.

  The comment-thread question is answered no, and the arithmetic is why: at
  $0.04 an Instagram thread page the plan's month is one day's polling.

  One box is open and it is not code. The test-mode price behind
  `STRIPE_PRICE_ID_KEYS_INCLUDED` is still $49; $35 needs a new Stripe price
  object, which the owner makes. US-131 sells it.
