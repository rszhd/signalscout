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

**Position is now stored, as `posts.thread_position`** (migration 0032). Three
decisions in it are worth knowing before reading any measurement taken with it.

It is the **provider's** index, not ours, and it counts every item the provider
returned — including the ones a connector then dropped for being out of window
or belonging to another post. So stored positions have gaps, and a gap is
evidence that something was refused there. A numbering that closed those gaps
would say a comment sat higher in its thread than it did, which is the one
thing this measurement reads.

It **counts through the whole walk**, not per page: `ReplyRequest.positionOffset`
carries the running total and `ReplyResult.itemsReturned` supplies it. That
second field is new and useful beyond this ticket — it is the provider's own
count against what we kept, which is exactly the gap BUG-007 hid.

Rows stored before migration 0032 have null. They are not backfilled and cannot
be: the order they arrived in was never written down.

**Cost is the reason this is worth building, so it must be shown.** A person
looking at a thread this stopped reading should be able to see what continuing
would cost. `estimate/` already turns units and prices into money and
`docs/costs.md` holds the rules — never price from a post count, always from
`unitsConsumed`.

## Acceptance

- [x] A thread is read in batches of a configurable size, defaulting to **50**
      comments, rather than a fixed number of provider pages. The batch is
      counted in comments so it means the same thing on every provider
- [x] After a batch has been through triage and classification, reading
      continues only if that batch produced **at least one** match. The
      threshold is a setting; its default is 1
- [x] Reading stops after **two consecutive** empty batches rather than one,
      unless the setting says otherwise. One empty batch mid-thread is a dead
      patch; two is a dead thread. At a batch of 50 this is not a nicety: a
      single-empty-batch rule would stop a genuinely good thread about one time
      in ten over a long read, and the two-in-a-row rule takes that to one in
      two thousand
- [x] **Before any of the above is built**: the lead rate is measured by
      position within a thread, in the provider's own page order. The Log says
      whether leads spread evenly, cluster at the top, or cluster at the bottom
- [x] The comment's position in the page the provider returned is stored, so
      this question can be asked again without buying the thread twice
- [x] A ceiling bounds the total comments one thread may buy, and it is the
      control that actually protects the bill. A monitor's budget cap still
      refuses a batch before it is bought
- [x] The decision is recorded per thread: how many comments were read, how
      many matched, and whether reading stopped because of the threshold, the
      ceiling, the budget, or the end of the thread. A person asking "why did
      it stop" gets an answer
- [x] The inbox shows, under the post a reply hangs from, how many comments
      were read of how many the platform claims, and why reading ended
- [ ] What continuing would cost is shown as money, priced from
      `unitsConsumed` and the model's own prices, never from a comment count
- [x] `repliesPartial` keeps its current meaning. A thread stopped by this rule
      is partial, and that is not the same claim as the provider saying there
      is more
- [ ] The Log records the first few live runs: how deep threads were read, how
      often the threshold stopped one, and whether any thread it stopped was
      later found to hold leads further down

## Notes

- Depends on [US-020](../doing/US-020-a-monitor-can-include-comments-and-replies.md),
  which holds the replies step and its two current bounds.
- `maxPagesPerThread` should probably go when this lands, or become the ceiling
  rather than the rule. Two bounds that both limit depth, by different units,
  is how a person ends up reading 204 comments on one platform and 100 on
  another without choosing either.
- **The continuation is automatic. The owner decided this on 2026-09-06**, when
  asked whether it should be a button past some amount: "it should be auto, not
  waiting for user." So there is no confirmation step at any depth.

  What that removes, the budget must carry. Automatic spending with nobody
  watching is the failure `docs/testing.md` names for this surface, and the
  answer is not a prompt but a cap that actually stops: the monitor's budget
  refuses a batch before it is bought, the ceiling bounds a thread that keeps
  clearing the threshold, and the reason it stopped is recorded per thread so a
  person reading the bill afterwards can see what happened without having been
  present.
- The re-open rule already stops a thread being re-bought when nothing new was
  said. This is a different question — how much of what is already there to
  read — and the two must not be confused. A thread stopped early has *more to
  read now*, where an unchanged thread has *nothing new*.
- A thread that stops early and is never returned to is a decision, not a bug.
  Say so on the screen, or a person will assume the product read everything.
- `measure:lead-position` is the instrument for the first box. It pages a
  thread cheaply and classifies only the positions asked for, because fetching
  is a credit for fifty comments and a classification is 2,975 micro-dollars —
  reading a 1,713-comment thread to the end is about $5 to answer a question
  two samples answer. It writes its comments with positions, so a later run can
  add a band without re-buying the pages before it.

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

- 2026-09-06T17:05+08:00 — The measurement ran, on `@dermarkologist`'s
  1,713-comment thread, against the skincare monitor. Two bands of fifty:
  positions 0-49 and 400-449, the same thread and the same model, differing
  only in where TikTok ranked them. Ten pages, ten credits, and the positions
  paged cleanly through — 48, 49, 45, 49, 48, 50, 50, 50, 50, 18 items.

  Three things went wrong on the way and each is worth keeping.

  **The instrument's first report was wrong in the direction of its own
  hypothesis.** It divided matches by comments *read* rather than by comments
  *classified*, and the budget cap had stopped classification after 11 of the
  deep band's 50. So 39 comments nobody had read counted as "not a lead", and
  the deep band printed 6.0% when the eleven read were running at 27.3%. It is
  the error `docs/costs.md` names for money — never divide by a count of things
  you did not pay for — and it flipped the answer this ticket turns on.

  **The budget guard refused work live, for the first time in this
  repository.** AGENTS.md has said since US-013 that it has never refused a
  real poll. It stopped classification mid-batch at $1.0017 of a $1.00 cap,
  logged the reason, and left the posts it did not reach with their place kept.
  That is BUG-004's open box, produced by accident rather than by design.

  **Four credits were spent by a bug in this instrument.** An edit adding the
  `--report-only` guard aborted before writing, the type error it left behind
  was fixed without re-reading the file, and the "report from what is stored"
  run went and re-fetched four pages. AGENTS.md already carries that lesson
  about edits that silently do not apply.

  That run also exhausted the SocialCrawl account: 402, zero credits remaining.
  Every platform except Bright Data and ScrapeCreators runs on that key, so
  nothing can be fetched until it is topped up.

- 2026-09-06T17:20+08:00 — **The answer is the third one, and it means this
  ticket as written would have made the product worse.**

  | Band | Classified | Matched | Rate | Mean score |
  |---|---|---|---|---|
  | 0-49 | 49 | 5 | **10.2%** | 61 |
  | 400-449 | 49 | 15 | **30.6%** | 66 |

  **Three times the lead rate four hundred comments deep**, on the same thread,
  the same monitor and the same model. Fisher's exact test, one-sided, gives
  p = 0.011, so this is not a coincidence of a small sample — though it is one
  thread on one platform and that is the limit of what it proves.

  The owner predicted it by asking one question of the first draft: ranked best
  *for whom*. TikTok ranks a comment by engagement. The top of this thread is
  reactions — "Tretinoin destroyed my skin😭" — which collect likes because
  other people feel the same. Four hundred down are the unanswered questions:
  "It's giving rashes. Please is it normal?" at 86, "What's a good face
  cleanser and moisturize to pair with these" at 81, "can i use tretinoin or
  azelaic combo for melasma uneven skin i wasted so much money on different
  products" at 69. **Nobody likes a question, so a question sinks.** The
  ranking this product wants is close to the inverse of the one the platform
  applies.

  **So the stop rule in this ticket's Acceptance must not be built.** A monitor
  that read the first hundred comments of this thread and stopped on a poor
  yield would have thrown away the best part of it — fifteen leads, including
  four of the five highest-scoring comments found anywhere in the thread.

  What survives is everything the stop rule was carried on: batching counted in
  comments rather than provider pages, the ceiling, the budget refusing a batch
  before it is bought, the per-thread record of why reading stopped, and the
  cost shown to a person. Those are about *bounding* the spend, and they are
  still right. What dies is *yield in batch one deciding whether to buy batch
  two*, because batch one is the least representative part of the thread.

  Two directions replace it, and neither is written yet:

  * **Ask for a different order.** No connector here sends a sort parameter for
    comments. If an endpoint can return newest-first, an unanswered question
    from this week is reachable without paying for four hundred popular ones
    first. That is the cheap fix and it should be measured before anything else
    is built.
  * **Spend depth where the thread earns it.** A deep read is worth more than a
    shallow one here, so the question is which *threads* deserve depth, not
    which batch to stop at. That is a different feature from the one this
    ticket describes.

  The ticket stays open and its Acceptance needs rewriting against this. The
  measurement cost about $0.90 of model spend and 14 credits, and it was worth
  it: building the feature as specified would have cost more than that on the
  first busy thread it met, and lost leads while doing it.

- 2026-09-06T17:40+08:00 — **"Always newest-first where we can" is the owner's
  standing decision, and the answer is that only one endpoint can.** Asked of
  every comment endpoint, using the provider's own free `/v1/utility/endpoint`
  guide rather than by guessing parameter names:

  | Endpoint | Sort | State |
  |---|---|---|
  | YouTube, SocialCrawl | `order=top\|newest` | **already `newest`** since US-034 |
  | TikTok, SocialCrawl | none — `url`, `cursor`, `trim` | cannot |
  | X replies, SocialCrawl | none — `url`, `cursor` | cannot |
  | Reddit, SocialCrawl | none — `url`, `cursor`, `trim` | cannot |
  | Reddit, ScrapeCreators | `sort` exists and is **broken** | must not send |

  So no code changed for the platforms, because the one platform that offers
  the ordering was already asking for it. That is worth knowing rather than
  disappointing: YouTube's connector is the only one whose first page is
  already the page US-048's measurement says is worth reading.

  **ScrapeCreators' Reddit comments endpoint is a trap.** `sort=new` and
  `sort=top` each return **zero comments and still bill a credit**, on a post
  that returns nine without them; a value the provider does not recognise is
  ignored and answers normally. So the parameter is understood and it empties
  the result. Measured twice. `client.ts` now says so where somebody would
  otherwise add it.

  Two free techniques came out of this and both belong in `docs/sources.md`.
  An invalid parameter value makes a provider name its own vocabulary at no
  charge — that is how YouTube's `order` was found. Better still, SocialCrawl
  publishes `/v1/utility/endpoint?id=<endpoint>`, which returns every
  parameter, the credit cost, the paging style and the caching rule, for zero
  credits. Nothing in this repository had used it, and several of the
  questions past captures paid to answer are written there.

- 2026-09-06T18:05+08:00 — **The stop rule goes back in, at a threshold of one,
  and the owner is right that it must exist.** The previous entry said the rule
  must not be built. That conclusion was too broad: it argued against a
  *threshold set to predict yield*, and then rejected the whole mechanism.

  A threshold of one is a different instrument. It does not ask "is the next
  batch worth as much as this one" — the question the measurement showed cannot
  be answered from batch one. It asks **"is anybody in this thread talking to
  us at all"**, and that question a first batch can answer.

  The arithmetic settles it. For a batch of 100 to show zero matches:

  | The thread's true lead rate | Chance the rule stops it |
  |---|---|
  | 30% (the deep band measured) | 0.0000% |
  | 10% (the top band measured) | 0.0027% |
  | 5% | 0.59% |
  | 2% | 13% |
  | 1% | 37% |

  So a threshold of one **cannot** stop a thread like the one measured: its
  weakest band ran at 10%, where the chance of a blank hundred is under three
  in a hundred thousand. It only stops threads running below about 2%, which
  are the threads nobody should be paying to read. That is the opposite of the
  failure the previous entry feared, and it is why the number matters so much:
  at a threshold of five the same rule would stop good threads regularly.

  **And the bound is not optional.** A classification is 2,975 micro-dollars,
  so an unbounded read is $2.98 per thousand comments, $29.75 per ten thousand,
  and **$297.50 on a hundred thousand** — one thread. The owner's point stands
  on its own: no yield argument is needed to justify stopping somewhere.

  Two things the measurement still changes. Reading stops after **two**
  consecutive empty batches rather than one, because leads sink and a dead
  patch mid-thread is not a dead thread — the insurance costs one extra batch,
  about $0.30. And **the ceiling, not the threshold, is what protects the
  bill**: the threshold will almost never fire on a thread worth reading, so
  the number that decides what a busy thread costs is the maximum depth.

- 2026-09-06T18:15+08:00 — **The batch is 50, not 100**, at the owner's
  direction: at least one match every 50 comments to buy the next 50.

  Three things recommend it over 100, and one thing it costs.

  **It is one page.** The TikTok comment pages measured this afternoon came
  back 48, 49, 45, 49, 48, 50, 50, 50, 50 — so a batch of 50 is about one
  credit and one call on SocialCrawl, and two on ScrapeCreators Reddit at 25 a
  page. The batch and the purchase line up.

  **It halves the minimum spend.** A batch of 50 classifications is $0.15
  against $0.30, so a dead thread is dropped after $0.30 of reading rather than
  $0.60.

  **It reacts sooner.** A thread that turns out to be barren is abandoned after
  100 comments instead of 200.

  What it costs is a higher chance of stopping a live thread, and the
  two-in-a-row rule is what pays it back:

  | Thread's true lead rate | One batch of 50 is empty | Stops a live thread over 20 batches |
  |---|---|---|
  | 30% | 0.000% | 0.000% |
  | 10% | 0.515% | 0.050% |
  | 5% | 7.7% | 10.7% |
  | 2% | 36% | 93% |

  Read the 5% row before changing the batch size again. With a **single**
  empty batch ending the read, a 5%-lead thread would be abandoned about one
  time in three over a long walk; requiring two in a row brings that to one in
  ten, and at the 10% rate this afternoon's weakest band actually ran, to one
  in two thousand. At a batch of 100 the same rule is safer still. So the pair
  — batch size and consecutive-empties — must be chosen together, and neither
  number means anything alone.

- 2026-09-06T17:55+08:00 — **The loop is built.** A thread is read fifty
  comments at a time; the batch goes through the filter and the classifier;
  `classify` hands the thread back to `replies`; `replies` decides whether to
  buy the next fifty. The rule lives in `replies.ts` alone — `classify` says
  only "these threads have been judged", because a step that scores posts must
  not also own how deep a thread is read.

  Four columns carry the walk across jobs, since it now outlives one:
  `replies_cursor`, `replies_batch_start`, `replies_empty_batches` and
  `replies_stopped`, plus `replies_stopped_at_count`. Migration 0033.

  **Two bugs were found by writing the tests, and both would have been close to
  invisible live.**

  The first is the window. `replies_read_at` is written when a walk starts, so
  a second batch computing `since` from it asked the provider for comments
  newer than the moment batch one ran — and every comment in the thread is
  older than that. The batch came back empty, the threshold read that as
  "nobody here", and a thread would have been abandoned after two batches
  having actually been read once. A batch walk is not a search for new
  comments: it pages through comments that already exist, from a cursor the
  provider issued. So the date cut now applies to the first batch of a walk and
  nowhere else.

  The second is that `replies_stopped` was a life sentence. A thread abandoned
  on two empty batches in March would never be read again however busy it
  became — which is the case a monitor exists to catch. `replies_stopped_at_count`
  is the fix: when the platform's own count passes what it was when reading
  stopped, the walk starts fresh, cursor and depth and empty-counter all reset.

  Both have tests, and removing either rule turns one red.

  What is left: the screen. Nothing yet shows how much of a thread was read, of
  how many, and why reading stopped — and the reason for stopping is the part a
  person cannot guess. `replies_stopped` holds the answer; no view reads it.

- 2026-09-06T18:05+08:00 — **The inbox says what it read.** Under the post a
  reply hangs from: "100 of 1,713 comments read. Stopped: two batches in a row
  held no lead."

  The reason is the half nobody could infer, and it is why this is a sentence
  rather than a number. "100 of 1,713, two batches held nothing" and "100 of
  1,713, the monitor ran out of budget" look identical as a fraction, and they
  call for opposite actions — one is a judgement about the thread, the other is
  a bill to raise.

  Nothing is shown while a thread is still being read. A count that moves on
  its own invites a person to read meaning into it, and "still going" is not a
  fact worth a line.

  `parentRepliesRead` is `replies_batch_start`, which counts what the provider
  handed over rather than what survived storage — the depth reached, not the
  harvest. Showing the harvest would make a thread look shallower than it was
  read, which is the wrong direction for a person deciding whether the quiet
  means anything.

  Three tests, and removing the sentence turns two of them red.
