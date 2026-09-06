---
id: US-048
title: A deep thread is read in batches and stopped early
type: feature
priority: p2
created: 2026-09-06T16:20+08:00
parent: US-020
area:
resolution:
---

## Context

**A thread with a thousand comments costs a thousand model calls, and nobody
here knows what the last nine hundred are worth.** US-044 measured a TikTok
video with 1,165 comments and another with 2,618. Today's comment run read 60 comments for
$0.198 — most of that the classifier, at 2,975 micro-dollars a call — so one
deep thread read to the end is a few dollars, and a poll that opens
twenty-five of them is not a rounding error.

The owner asked for the shape: **read 100, say how many leads came out, and
only read the next 100 if that number justifies it.**

**What exists today is a page bound, and it is the wrong instrument.**
`maxPagesPerThread = 4` stops at four pages, which is 100 comments at
ScrapeCreators and 204 at SocialCrawl — so "how deep do we read" currently
depends on which provider answered, which nobody chose. It also cannot stop
early on a thread that is going badly, and cannot go deeper on one that is
going well. It is a bound on damage, not a decision.

**The hard part is the ordering of the steps, not the counting.** Whether a
comment is a lead is known only after triage and classification, and both run
*after* the replies step has finished and handed its rows to the filter. So
this cannot be a loop inside `replies.ts`. The batch has to go all the way
through the pipeline, and the decision to buy the next batch has to be made
with the verdicts in hand. That is a new shape for this worker — every step
today runs once per poll and passes forward — and it is the main thing to
design before writing code.

**Whether yield decays with depth is unknown, and the first draft of this
ticket got it wrong.** That draft said the threshold must be set *below* the
observed rate, because every endpoint returns its best-ranked page first and
batch one is therefore the strongest sample. The owner asked the question that
undoes it: **ranked best for whom?**

A platform ranks a comment for a general viewer — likes, replies, recency,
whatever holds attention. This product wants **intent**, which is a different
axis and plausibly an opposing one. A joke with six thousand likes ranks top.
A person asking "would the yumu one be better?" has no likes at all, because
nobody likes a question. So the platform's order is not evidence about our
order, and treating it as evidence was the mistake.

Two further facts make it worse. **No connector here sends a sort parameter for
comments.** Every one takes the endpoint's default order and pages from there,
and no capture has asked what that order is — `tiktok-fixtures/capture.mjs`
raises exactly this doubt about the *search* endpoints and nobody has put the
same question to the comment endpoints. And the one number that looked like
evidence is not: the 60 TikTok comments classified on 2026-09-06 produced 7
matches, but they were selected `order by posted_at desc` — the **newest**, not
the top-ranked — so they say nothing about depth.

**Three outcomes are open, and they point to three different designs.**

* Leads spread evenly through a thread. Yield is stationary, batch one honestly
  predicts batch two, and the threshold in this ticket is a sound estimator
  rather than an optimistic one.
* Leads cluster near the top. The threshold must be discounted, as the first
  draft assumed without cause.
* **Leads cluster near the bottom.** Not far-fetched: an unanswered question is
  exactly the comment with no likes and no replies, which is what a
  popularity-ordered page puts last. If this holds, a stop rule is actively
  harmful and the feature should be inverted.

So the measurement comes before the build, and it is not the one the first
draft proposed. Read a thread's comments **in the provider's own page order**
and record the lead rate by position — 1 to 100, 101 to 200, and so on. That
answers whether our lead rate depends on where the platform put the comment,
which is the question this whole ticket rests on.

**One practical obstacle: position is not stored.** `posts` keeps the comment
and its date, not the place it arrived in. So the measurement needs either a
re-fetch of a thread already bought, or a column recording the position the
provider returned it at. The second is cheap and is the one that makes this
answerable again later.

**Cost is the reason this is worth building, so it must be shown.** A person
looking at a thread this stopped reading should be able to see what continuing
would cost. `estimate/` already turns units and prices into money and
`docs/costs.md` holds the rules — never price from a post count, always from
`unitsConsumed`.

## Acceptance

- [ ] A thread is read in batches of a configurable size, defaulting to 100
      comments, rather than a fixed number of provider pages. The batch is
      counted in comments so it means the same thing on every provider
- [ ] After a batch has been through triage and classification, the number of
      matches it produced decides whether the next batch is bought
- [ ] **Before any of the above is built**: the lead rate is measured by
      position within a thread, in the provider's own page order, on at least
      one deep thread. The Log says whether leads spread evenly, cluster at the
      top, or cluster at the bottom. A stop rule built before this answer is a
      guess about somebody else's ranking
- [ ] The comment's position in the page the provider returned is stored, so
      this question can be asked again without buying the thread twice
- [ ] The threshold is a setting with a default, and the default is written
      down as a judgement with its reasoning, not as a measured value it is not
- [ ] A ceiling bounds the total. A thread that keeps clearing the threshold
      must still stop somewhere, and a monitor's budget cap still refuses a
      batch before it is bought
- [ ] The decision is recorded per thread: how many comments were read, how
      many matched, and whether reading stopped because of the threshold, the
      ceiling, the budget, or the end of the thread. A person asking "why did
      it stop" gets an answer
- [ ] The inbox, or the monitor's page, shows for a deep thread how many
      comments were read of how many exist, and how many became matches
- [ ] What continuing would cost is shown as money, priced from
      `unitsConsumed` and the model's own prices, never from a comment count
- [ ] `repliesPartial` keeps its current meaning. A thread stopped by this rule
      is partial, and that is not the same claim as the provider saying there
      is more
- [ ] The Log records the first few live runs: what batch one yielded, what
      batch two yielded, and whether the second was worth its price. **This is
      the measurement the whole feature exists to make**

## Notes

- Depends on [US-020](../doing/US-020-a-monitor-can-include-comments-and-replies.md),
  which holds the replies step and its two current bounds.
- `maxPagesPerThread` should probably go when this lands, or become the ceiling
  rather than the rule. Two bounds that both limit depth, by different units,
  is how a person ends up reading 204 comments on one platform and 100 on
  another without choosing either.
- **Consider whether the continuation is automatic or a button.** The owner
  described a threshold, which is automatic. Automatic spends money with nobody
  watching, which is the failure `docs/testing.md` names for the budget
  surface. A middle answer exists: automatic while cheap, and a button past
  some amount. Decide it deliberately rather than by default.
- The re-open rule already stops a thread being re-bought when nothing new was
  said. This is a different question — how much of what is already there to
  read — and the two must not be confused. A thread stopped early has *more to
  read now*, where an unchanged thread has *nothing new*.
- A thread that stops early and is never returned to is a decision, not a bug.
  Say so on the screen, or a person will assume the product read everything.

## Log

- 2026-09-06T16:20+08:00 — Written at the owner's request, after US-044
  measured TikTok videos holding 1,165 and 2,618 comments and a comment run
  cost $0.198 for sixty. The idea is theirs: read a hundred, count the leads,
  and let that number decide whether to buy the next hundred.

- 2026-09-06T16:35+08:00 — The owner corrected the ticket's central assumption
  before anything was built. It claimed the first page is the best page and the
  threshold must therefore be discounted. They asked whether "best" means best
  for the platform or best for the monitor's query, and it means the first: a
  platform ranks for engagement and this product wants intent, which is a
  different axis and may be an opposing one.

  The claim was mine and it had no measurement behind it. The number that
  seemed to support it — 7 matches in 60 comments — came from a sample ordered
  by date, not by rank. The Context is rewritten and two boxes were added:
  measure the lead rate by position first, and store the position so the
  question survives.
