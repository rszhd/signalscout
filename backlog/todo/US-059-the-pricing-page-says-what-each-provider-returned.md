---
id: US-059
title: The pricing page says what each provider returned
type: feature
priority: p2
created: 2026-09-07T15:00+08:00
parent: US-058
area:
resolution:
---

## Context

**US-058 answers what a provider costs. It does not answer whether the money
was well spent.** The owner asked for a rating so a person could weigh value
rather than price, and the instance's own data argues against a rating while
proving the need for the second half.

**The argument against a score, in one table, from this deployment:**

| Platform | Provider | Match rate | Median post age | Spent |
|---|---|---|---|---|
| LinkedIn | SocialCrawl | 25.0% | 196 h | $5.93 |
| LinkedIn | Apify | 8.0% | 2.8 h | $0.05 |

On match rate SocialCrawl looks three times better. It is not. Its two matches
were a retry-policy tip and an article headlined "Brittle tests killing your
sprint velocity?", both scored at exactly the threshold, on posts eight days
old. **A single value score built on match rate would tell a person to keep
spending $5.93 with the worse provider.**

**So this ticket shows the measurements and refuses to compress them.** What
decided LinkedIn this week was four facts and not one number: Bright Data
cannot search it at all, ScrapeCreators reaches it through Google's index,
Apify returns posts 33 minutes old, and the platform's noise is
expertise-signalling whoever fetches it. A 4.2 out of 5 loses every one of
them.

**Freshness is the number that would have changed the decision, and it is
already computable.** `posts.posted_at` against `posts.provider`: Apify's
median is 2.8 hours and SocialCrawl's 196. Nothing on any screen says this
today, and it is the strongest thing a person comparing two providers can
read.

**Cost per match is value where cost per post is price**, and it is honest
only *inside* one platform. Across platforms it compares a monitor and a
threshold rather than a provider: Reddit through SocialCrawl matches at 21.4%
and YouTube through the same provider at 2.6%, which says nothing about
SocialCrawl.

**Every figure here rests on a small sample and must look like it.** Those
LinkedIn rates come from 20 and 25 posts. A percentage over 20 posts should
read as fragile on the screen, because it is.

**What the page still cannot answer is whether a match was any good.** A match
is our scoring's guess; a verdict is the person's judgement, and this instance
has **five**, all on one monitor. Cost per *good* lead is the figure the owner
actually wants and it is not computable yet.
[US-033](US-033-thirty-verdicts-say-whether-the-score-is-right.md) is what
makes it possible, and this ticket should leave the column ready and empty
rather than filling it with matches and calling them leads.

## Acceptance

- [ ] Each connector row shows the median age of the posts collected through
      it, from `posts`, so freshness sits beside price
- [ ] Each row shows how many posts were collected and how many became
      matches, with the rate
- [ ] Each row shows cost per match, derived from that pair's real spend and
      its real match count
- [ ] Every returned figure carries the number of posts behind it, and a row
      under about fifty posts is marked as too small to lean on
- [ ] A pair that has collected nothing says so, rather than showing 0% or a
      division by zero
- [ ] Match rate is never compared across platforms on the screen, and nothing
      combines these numbers into a single score or star rating
- [ ] The page says plainly that a match is our guess and a verdict is the
      person's judgement, and names how many verdicts exist
- [ ] Capabilities are shown as facts rather than scales: whether the connector
      searches by keyword, searches inside a channel, reads comments, and can
      link to a comment
- [ ] `pnpm test`, `pnpm lint` and `pnpm typecheck` pass

## Notes

- The query behind the first three boxes already works. It joins `posts` to
  `matches` on `post_id` and groups by `posts.source, posts.provider`.
- **Some `posts` rows have a null provider** — 126 Reddit posts collected
  before US-024 split the axes. They belong to no pair and must not be counted
  into one.
- Read [docs/costs.md](../../docs/costs.md). Cost per match is a new figure
  and it inherits every rule there: it is an estimate, it is not rounded to
  cents, and it is our count of what a provider charged rather than a bill.
- Do not add a score, a grade or stars. The reasoning is in the Context and in
  [US-036](US-036-a-provider-is-rated-per-platform-from-measurements.md), which
  refuses the same thing for a different reason.
- [US-036](US-036-a-provider-is-rated-per-platform-from-measurements.md) is a
  neighbour, not a duplicate: it asks which provider *could* fetch what, for
  connectors that do not exist yet, so that one subscription might be enough.
  This one describes what the connectors already running actually returned.

## Log

- 2026-09-07T15:00+08:00 — Written after the owner asked for a provider rating
  and then doubted it. The doubt was right: their own numbers rank the worse
  LinkedIn provider three times higher on match rate. The measurements go on
  the page; the score does not.
