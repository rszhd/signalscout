---
id: US-056
title: LinkedIn is measured at Apify
type: spike
priority: p2
created: 2026-09-07T13:38+08:00
parent:
area:
resolution: shipped
---

## Context

**Two providers have now been measured for LinkedIn and neither is going to be
used.** SocialCrawl works and costs $0.2030 for fifty posts, which US-053 is
switching off. ScrapeCreators costs $0.0094 and was built, tested and dropped
in US-055 because it finds posts through Google's index rather than through
LinkedIn — and a middleman that silently drops posts fails in a way no poll
would notice.

The owner named the third: `harvestapi/linkedin-post-search` on Apify. It
searches LinkedIn posts by keyword, and its own headline claim is **no cookies
and no LinkedIn account**.

**Its published price is $0.075 for fifty posts** — eight times ScrapeCreators
and 2.7 times cheaper than what is shipping today. But the actor page says
$1.50 per 1,000 posts and the developer's own repository title says $2, so the
number is unsettled and no price goes into a price field until a real run
reports what it charged. `provider.ts` holds prices we have a source for; a
guessed one looks exactly like a real one on a bill.

**Two of its features are better than either provider measured so far, and
both need proving.** It offers `sortBy: 'date'`, which neither other provider
has: a monitor wants what was said since it last looked, and a newest-first
list is what lets a connector stop paging instead of buying pages it will
discard. And it bills per post, so a query matching nothing costs nothing by
construction — the property that keeps Bright Data in this repository.

**Apify is a provider, not a connector, and that is the real size of this.** It
runs an actor asynchronously: start a run, poll it, read a dataset. That is
Bright Data's snapshot shape, which `NextPage` already carries a `wait` state
for and which `source_continuations` already survives a restart for. This
ticket does not build any of it. It asks the questions, because US-055 is the
second time in two days that building before measuring would have wasted the
work.

**Nine questions the documentation cannot settle.**

1. What is one post on the wire — every field, not the ones a parser would
   read today.
2. **Is the id the activity id?** SocialCrawl returns `7500190661334249473`
   and ScrapeCreators puts the same number in the post URL. If this provider
   agrees, all three deduplicate against each other and `posts` needs nothing
   new. If it does not, a post could be collected and billed twice.
3. What does a run report as charged? The run object carries
   `usageTotalUsd` and, for a pay-per-event actor, `chargedEventCounts`. That
   is `unitsConsumed` measured rather than assumed.
4. **Does `sortBy: 'date'` really sort?** The whole early-stop rule rests on
   it, and a parameter that is accepted and ignored is the shape of BUG-002.
5. Does `postedLimit` narrow, and which of `1h`, `24h`, `week`, `month` are
   real?
6. What does a query that matches nothing return, and what does it cost?
   SocialCrawl bills a LinkedIn search matching nothing in full; ScrapeCreators
   refunds it. There is no safe assumption.
7. What does a refused token say, with what status, and is that free?
8. **How long does a run take?** It decides whether the connector waits inside
   one job or hands a continuation back to the scheduler, and the answer is a
   number rather than a preference.
9. Are comments included, and are they charged separately? They are the half
   that carries the lead on every other platform here. Do not turn them on in
   this run; find out what they would cost.

## Acceptance

- [x] A capture script runs the actor with a token, records what came back,
      and writes what each run was charged beside the fixtures
- [x] The fixtures are scrubbed of names, headlines and employers, and were
      read by a person before being committed
- [x] All nine questions above are answered in the Log, or named as unanswered
      with the reason
- [x] The run's total cost is recorded, from the provider's own numbers
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it

## Notes

- `maxPosts: 0` means *all posts*. Never send it. Every run in this capture
  passes a small explicit limit.
- Do not enable `scrapeComments` or `scrapeReactions`. They are charged
  separately and question 9 asks their price, not their contents.
- Read `docs/sources.md`, *adding a provider*, before writing any connector
  code. This ticket is the measurement only.
- The two earlier measurements are in
  [US-054](../done/2026-09/US-054-linkedin-is-measured-at-the-other-provider.md)
  and [US-055](../done/2026-09/US-055-linkedin-is-fetched-through-scrapecreators.md).
  US-055's Log lists three pieces of its dropped connector worth reusing.
- [US-053](US-053-a-connector-ships-without-being-offered.md) still comes
  after whatever replaces SocialCrawl, not before. Switching it off first
  leaves no LinkedIn at all in between.

## Log

- 2026-09-07T13:38+08:00 — Written when the owner rejected the ScrapeCreators
  route and named this actor. The token is in `.env`.

- 2026-09-07T14:05+08:00 — Ran the capture. **Three actor runs and one refused
  token, $0.04115 in total.**

  **The number that decides this is not the price. Every post came back under
  ninety minutes old.** Ten posts spanning 04:04 to 05:15 against a capture at
  05:15 — a 71-minute page. ScrapeCreators' newest was three days old and
  SocialCrawl's answers ran across weeks, because both order by relevance. This
  product exists to reach somebody while their question is still open, and this
  is the first LinkedIn provider that returns that.

  **The answers, in order.**

  1. A post carries 19 fields: `id`, `linkedinUrl`, `content`, `author`,
     `postedAt`, `postImages`, `engagement`, `comments`, `commentIds`,
     `reactions`, `reactionIds`, `entityId`, `shareUrn` and more. `content` is
     the post text — a median of 1,567 characters over the ten. `postedAt` is
     an object: `{ timestamp, date, postedAgoShort, postedAgoText }`.
  2. **The id is the activity id.** `id: "7502587310513893376"`, ten of ten,
     all distinct, and the same number appears in `linkedinUrl` as
     `-activity-<id>-`. That is the identifier SocialCrawl returns as `id` and
     the one ScrapeCreators hides in its URL, so **all three providers
     deduplicate against each other** and `posts` needs nothing new.
  3. `chargedEventCounts` gives the breakdown and `usageTotalUsd` the bill:
     `{apify-actor-start: 1, post: 10}` and $0.02005. That is $0.002 a post plus
     $0.00005 for the run, matching the actor's own published FREE-plan price
     exactly.
  4. **`sortBy: "date"` selects recent posts but does not order them.** The ten
     came back 04:43, 04:30, 04:29, 05:15, 05:14, 04:48, 04:37, 04:11, 04:04,
     05:12. So a connector may not stop paging on "this page is older than
     `since`" — the rule that is right on `x.ts` and wrong on both other
     LinkedIn connectors is wrong here too. The saving grace is that it barely
     matters: the whole page is inside 71 minutes.
  5. **The window is unanswered, and it could not be answered by this run.**
     `postedLimit: "week"` returned 9 of the same 10 posts. A week cannot
     narrow an answer that is already 71 minutes wide. Asking it properly needs
     a query with enough history to have older posts to exclude.
  6. **An empty query is not free.** The impossible phrase returned `[]` and
     was billed $0.00105 — a `no-result` event at $0.001 plus the run. That is
     a third answer: SocialCrawl bills a LinkedIn search matching nothing in
     full, ScrapeCreators refunds it, and this one charges a tenth of a post.
  7. A refused token answers **401** with
     `{"error": {"type": "user-or-token-not-found"}}`, and no run starts, so the
     probe is free.
  8. **A run took 10.5, 6.6 and 3.3 seconds.** Bright Data's snapshots take
     minutes. A connector could plausibly wait inside one job, though the
     asynchronous shape is still what the API offers.
  9. **Comments are not in the answer unasked**: `comments: []` and
     `commentIds: []` on every post. They are a separate charge at **$0.002
     each on FREE**, the same as a post — cheaper than Instagram's five-times
     multiplier and dearer than TikTok's.

  **The prices are tiered by Apify plan, which resolves the $1.50-against-$2
  contradiction.** From the actor's own `pricingInfos`: a post is $0.002 on
  FREE and BRONZE, $0.00175 on SILVER, $0.0015 on GOLD and above. The actor's
  page quotes the GOLD price. **This account is on FREE**, so fifty posts cost
  **$0.10 here** and $0.075 on a paid plan.

  **Two things the capture got wrong and fixed, and one of them is a warning
  for the connector.**

  The script read `usageTotalUsd` at the moment the run stopped and got
  $0.00005 — the start event alone — for a run that had just returned ten
  posts. **Apify settles a pay-per-event bill after the run finishes**, and the
  same read a few seconds later gave $0.02005. A budget guard fed the first
  number would price every poll at five thousandths of a cent and would never
  refuse anything. The connector has to wait for the bill, and that is now in
  the script as `settledRun`.

  The scrubber leaked three things the field lists did not name: the author's
  `info`, which is their whole professional headline; the raw member id
  `ACoAA…` in `author.id`, `author.profileId` and every profile mentioned
  inside a post; and the same id inside the query string of the author's URL.
  It also destroyed every post URL, by treating `linkedinUrl` as identity when
  on a post it is the post's own address. **All four were fixed and the
  fixtures re-scrubbed for nothing**, because a dataset outlives its run on
  Apify — `--rescrub` re-reads what was already bought. That is the third
  LinkedIn capture in three days whose scrubber was wrong in a way only reading
  the output showed.

- 2026-09-07T14:07+08:00 — **Recommendation: build it.** The number that
  decides it is 71 minutes, not $0.10.

  Read the price honestly: at $0.10 for fifty posts this is **ten times
  ScrapeCreators** and half of SocialCrawl. It is not the cheap option. What it
  is, is the only one of the three that answers "who said this in the last
  hour", which is the question this product asks. A lead nobody has answered
  yet is worth more than ten leads from three weeks ago, and US-052's whole
  argument — that a lead has a shelf life — is the same argument.

  Two things to settle before or during the build. **The window question is
  open**, and it decides whether a monitor can bound its own cost or has to buy
  a fixed page every poll. And **a poll that runs hourly on a page that is 71
  minutes wide will mostly buy posts it already has** — deduplication will
  catch them, but the bill will not, because this provider charges per post
  returned rather than per post kept. That is the opposite of the
  charge-per-request providers and it is the one place this connector could
  quietly cost more than it looks.
