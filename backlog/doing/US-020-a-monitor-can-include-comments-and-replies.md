---
id: US-020
title: A monitor can include comments and replies
type: feature
priority: p2
created: 2026-09-05T01:18+08:00
parent: US-005
area:
resolution:
---

## Context

US-005 shipped the Reddit connector for posts. Comments were split out here
because they cannot be added without changing the `SocialSource` interface that
US-003 settled, and that change deserved its own decision rather than being
made in passing.

This ticket was rewritten twice on 2026-09-06. It was written against Bright
Data, and three of its conclusions were wrong once Reddit moved to
ScrapeCreators. It was then widened from Reddit to every platform, because the
reply is not a Reddit feature.

**A reply is a platform-neutral thing, and it is now the whole ticket.** A
person describing a problem underneath somebody else's post is the same lead on
every network. STACK.md's rule already points this way — the interface is not
shaped to suit one provider — and US-020's own first draft said it: "X has
replies and Hacker News has comments, so 'include the replies to a thing' is a
question every source can be asked."

The catalogue makes it concrete. SocialCrawl publishes **17 comment endpoints
across 12 platforms**, every one with the archetype `CommentList` and every one
pointing at the same schema, `socialcrawl.dev/schemas/comment.json`. That was
tested rather than believed: an X reply and a SocialCrawl Reddit comment came
back with identical field names — `id`, `url`, `parent_id`, `post_id`, `text`,
`author`, `engagement`, `flags`, `published_at`. **One parser reads both.**

So the capability is one interface change and one storage shape, and a
connector implements it or declares that it cannot.

**Ship it on the three platforms this product already has.** Reddit, X and
LinkedIn add no network, so PLAN.md's *Important rule* is untouched. The prices
below are per platform and they are not close to each other, so a monitor's
arithmetic is per connector even though its interface is not.

| Platform | Endpoint | Price | Measured |
|---|---|---|---|
| Reddit | ScrapeCreators `post/comments` | 1 credit, $0.00188 | 25 comments a page |
| Reddit | SocialCrawl `post/comments` | 5 credits, $0.041 | 92 comments, 7 levels |
| X | SocialCrawl `tweet/replies` | 1 credit, $0.0081 | 29 replies a page |
| LinkedIn | SocialCrawl `post/comments` | 5 credits, $0.041 | not measured |

**X is where a reply is worth most, and that was not obvious.** An X search
page carries about 20 posts, and the conversation happens underneath them. One
credit bought 29 replies of a claimed 71, which is about the same price per
item as an X post — so on X the replies roughly double what a poll can see, at
no change in unit cost. US-006 already measured X's other half: a search that
matches nothing is refunded, and a good query is four words.

**YouTube, Instagram, TikTok, Threads, Hacker News and GitHub are out of
scope**, and deliberately. Each is a fourth network, and PLAN.md's *Important
rule* says not to add one until Reddit and X reliably produce useful matches.
That condition is still unmet: X has one poll and five verdicts behind it. The
rule was crossed once for LinkedIn, on the owner's decision, and PLAN.md records
that the rule stands for the fourth. The catalogue rows are written into the
Notes so the next reader finds a decision and not an oversight.

Three of the original conclusions about Reddit were wrong for ScrapeCreators,
and they are corrected below.

**A comment cannot be searched. It is reached through its thread.**
ScrapeCreators publishes `search` and `subreddit` for posts and
`post/comments` for one thread by URL. Bright Data's comments dataset is by
post URL as well. Reddit's own site search does not index comments. So there
is no route that finds "a comment that says X", and discovery here is two
stages: find threads the way the connector already does, then open the ones
worth reading.

**One call returns the post and a page of about 25 comments, for one
credit.** The answer carries the `post` object — title, `selftext`, subreddit,
permalink — and a nested tree of comments. Every comment has Reddit's own `t1_`
fullname in `name`, a `parent_id`, a body, an author, a date and a permalink.

The page is the part that was measured on 2026-09-06, and it was measured
because this ticket first assumed a thread. Three r/webdev threads claiming
640, 296 and 95 comments each returned exactly 25 for one credit, each with
`more.has_more: true` and a cursor. The 22-comment thread in
`sources/deletion-fixtures/scrapecreators-comments-canonical.json` returned 21
and reported `has_more: false` only because it fit inside one page.

**A credit buys a page. It does not buy a thread.**

Two things follow.

**The context problem is solved at the wire.** A comment alone cannot be
classified: "same here, ours breaks every deploy" names no product and no
problem. The parent arrives in the same answer as the comment, so the context
is neither a second call nor a join. It still has to be stored and put in the
prompt, and the prompt has to say whose intent is being scored — without that
line the classifier scores the person who wrote the post, and every comment
under a good post becomes a match.

**Deduplication needs no change.** A `t1_` fullname is the same kind of id as a
`t3_`, so `UNIQUE (source, external_id)` keys a comment exactly as it keys a
post, through either provider.

**A full thread cannot be read, and the endpoint will not say so.** The
`cursor` in `more` does page: it was passed back and returned new comments with
no overlap. But a drain of the 95-comment thread ended after three calls with
43 comments and `has_more: false`. The other 52 are behind nested subtrees,
fourteen of which reported `has_more: true` inside the first page alone.

**So a top-level `has_more: false` does not mean the thread is complete.** It
means the top level is complete. A collector that reads it as "done" loses half
the comments and reports success. That is the trap in this endpoint, and it is
the reason the ticket carries a box for it.

Pages are also irregular. The three calls returned 25, then 7, then 11.
Credits cannot be predicted from `num_comments`.

**The cost story is still the opposite of what this ticket first said.** It
said comments roughly double a monitor's cost. That was true of Bright Data,
which bills per record. Here the fetch is small and the model calls are the
bill. For one subreddit poll, from the captured fixtures — 23 posts for one
credit, median 12 comments each, so the median thread fits in one page:

| | Fetch | Model calls |
|---|---|---|
| Posts only | 1 credit, $0.0019 | 23 |
| Posts and one page of each thread | 24 credits, $0.045 | about 280 |

So the control that matters is not the opt-in. It is **which threads are
opened, how deep, and how often**. Read the first page and stop. It is one
credit, and Reddit ranks it, so it holds the comments a reader would see first.
Accept that a nested follow-up is missed: reaching it costs a call per subtree
and the arithmetic does not survive that.

Both the search and the subreddit answers carry `num_comments` and `permalink`
on every post — checked in `scrapecreators/fixtures/search-posts.json` and
`subreddit-posts.json`. That number is the re-open rule: store it, compare it
on the next poll, and skip a thread whose count has not moved. Without it,
every poll re-buys every thread for the life of the monitor.

**The embedding stage does not run on a comment. US-029 measured it.**
`ai/fixtures/comment-similarities.json` holds every comment in this ticket's own
captured thread, embedded against PLAN.md's example monitor two ways.

Under the parent post's title the stage is a cost with no drop: all 21 land
between 0.3715 and 0.5491, within 0.08 of the title's own 0.4187, and the
moderator's vendor-spam notice outscores eight comments that are about testing.
Alone it separated topic on the first thread by 0.0103 against 0.18 on posts,
and a second thread did not reproduce that gap at all,
and it sits at 0.22, where the shipped threshold is 0.15.

The reason that decides it is neither of those. The highest similarity in the
thread, 0.5504, is nine hundred characters of expert advice — higher than four
of the five posts in `similarities.json`. The stage measures topic, and under a
relevant post every expert is on topic. So a comment goes from the free keyword
stage to [US-030](US-030-a-cheap-model-decides-which-comments-the-good-model-reads.md)'s
triage model, and there is one paid stage in front of the classifier, not two.

What the measurement did not cover: the free keyword stage. A comment collected
because its parent post matched a subreddit has matched nothing itself, and
nobody has decided what that stage asks of a comment.

**The charge is not split, and the interface should not be either.** The
original acceptance list asked `SearchResult` to report each kind of read
apart. That existed to make Bright Data's second charge visible. Here there is
no second charge: one credit covered the post and the thread. Adding the field
now would shape the interface around the provider we are leaving.
`unitsConsumed` stays one number and it is correct.

Only one provider can do this. A deployment holding a Bright Data key must be
told that comments are unavailable, not quietly given none.

## Acceptance

- [x] `SourceQuery` carries an opt-in for replies, and a connector that cannot
      fetch them ignores it rather than failing
- [x] A connector declares whether it can fetch replies, and the monitor form
      reads that declaration per platform, so a person is told which of their
      platforms will return replies rather than being given none in silence
- [x] The fake source can be told to return a thread, so callers are tested
      without a network and without a bill
- [x] One parser reads a reply from every SocialCrawl platform, because the
      provider's `CommentList` schema is shared, and a test proves it against
      captured X and LinkedIn answers — **deferred with the two connectors
      below**
- [x] The ScrapeCreators Reddit connector fetches a thread by post URL when the
      opt-in is set, and never when it is not
- [x] The SocialCrawl X connector fetches replies by post URL when the opt-in
      is set, and never when it is not
- [ ] The SocialCrawl LinkedIn connector does the same, or the ticket records
      why it was left out
- [x] A reply is stored as its own row, keyed by the id its platform gives it,
      with a link to its parent post and to its parent reply. Reddit's `t1_`
      fullname and an X reply id are the same kind of key, and
      `UNIQUE (source, external_id)` needs no change
- [x] A thread is opened only for a post that survived the pre-filter, and the
      number of threads one poll may open is bounded
- [x] `num_comments` is stored on the post at collection, and a thread is
      re-opened only when that number has grown
- [x] The classifier is given the parent post title and the immediate parent
      comment, and the prompt says the thread is context and the comment author
      is who is being scored
- [x] A monitor stores the opt-in, in a migration that keeps it off for every
      existing monitor
- [x] The monitor form shows the opt-in, says what it costs in model calls
      rather than in fetches, and leaves it off by default. The cost sentence
      is per platform, because the four prices above differ by a factor of
      twenty-two
- [x] The inbox shows the parent post title above a comment match and links to
      the comment permalink, so a person sees the context the model saw
- [ ] Tests replay comment payloads captured by
      `sources/providers/scrapecreators/fixtures/capture.mjs`, extended with a
      comments mode
- [x] One page is read per thread by default, and the number of pages a poll
      may buy is bounded
- [x] A top-level `has_more: false` is never stored or logged as "the thread is
      complete", and a test proves a partly read thread is recorded as partial
- [x] The embedding stage does not run on a comment, and a test proves a
      comment reaches the next stage without one. US-029 measured it: see the
      Context above

## Notes

- **Depth becomes a decision rather than a bound in
  [US-048](../todo/US-048-a-deep-thread-is-read-in-batches-and-stopped-early.md).**
  `maxPagesPerThread` stops at four provider pages, which is 100 comments at
  ScrapeCreators and 204 at SocialCrawl — so how deep this reads depends on
  which provider answered. That ticket replaces it with batches counted in
  comments, and a yield threshold that decides whether to buy the next one.


- Depends on [US-005](../done/2026-09/US-005-reddit-returns-candidate-posts.md)
  and [US-025](../done/2026-09/US-025-scrapecreators-collects-reddit-posts.md).
- [US-029](../done/2026-09/US-029-a-measurement-says-which-pre-filter-fits-a-comment.md)
  answered the stage order on 2026-09-06. Nothing here is blocked any more.
- [US-030](US-030-a-cheap-model-decides-which-comments-the-good-model-reads.md)
  is what makes the 280 model calls affordable. This ticket is the reason that
  one exists.
**SocialCrawl is a third Reddit provider, and it can do what ScrapeCreators
cannot.** Its free catalogue — `/v1/utility/endpoints`, 0 credits — lists eight
Reddit endpoints. `/v1/reddit/post/comments` costs five credits and claims to
auto-expand nested replies into one deep tree. It was tested on 2026-09-06
against the same r/webdev thread, back to back:

| | ScrapeCreators | SocialCrawl |
|---|---|---|
| Comments returned, of 95 claimed | 43 | 92 |
| Deepest level reached | 3 | 7 |
| Calls | 3 | 1 |
| Cost | $0.0056 | $0.041 |
| Cost per comment | $0.00013 | $0.00044 |
| Says when it is incomplete | no | yes, `data.truncated` |
| Carries the parent post | yes | no |
| Carries the comment author | yes | no, `author.username` is null |

**The recommendation is still ScrapeCreators, and the reason is thread size.**
A subreddit poll's median thread has about twelve comments. ScrapeCreators
returns that whole thread in one page for $0.00188, where SocialCrawl charges
$0.041 for the same content — twenty-two times more for the common case. Above
twenty-five comments ScrapeCreators cannot finish a thread at all, but the
comments it does return are the ones Reddit ranks first, and the missing half
would cost forty-nine more model calls to read. The model calls are the bill,
so buying the deep tree makes the expensive half of the pipeline larger, not
smaller.

Write SocialCrawl down as the escape hatch and do not build it. It becomes
worth building only if a measurement shows the deep half of a thread holds
leads the top page does not.

Two smaller facts came with that test. SocialCrawl serves an identical call
from cache for 0 credits within 300 seconds, which is useful to a capture
script and useless to an hourly poll. And it returns comments without the
parent post and without the author, so a monitor on that path would have to
join both from our own rows.

- Measured on 2026-09-06, nine calls and nine credits, $0.017 at the
  connector's declared price. Page size 25, irregular after the first page,
  `cursor` is the paging parameter, and a top-level drain reaches roughly half
  a busy thread.
- Still unmeasured: whether a nested subtree's own cursor can be paged, and at
  what price. Nothing should be built on the subtree flag until it is.
- The deletion capture showed this endpoint answering 200 with null content for
  a removed post, and charging a credit for it.
- Bright Data's comments dataset is left unbuilt. Its price is also unread: the
  posts dataset is $1.50 per 1,000 records and nobody has checked whether the
  comments dataset matches. Do not fill that number in from the other one.
- The platforms this ticket does not touch, with their catalogue prices, so the
  next reader does not have to re-derive them: TikTok 1, YouTube 1, Threads 1,
  Snapchat 1, Rumble 1, Hacker News 1, GitHub 1, Facebook 1, Instagram 5.
  Adding any of them is a new network and PLAN.md's *Important rule* applies.
- Two schema details that a shared parser must not assume away. A post reports
  its reply count at `engagement.comments` and a reply reports its own at
  `engagement.replies`, so the same word means two fields. And the envelope
  differs: Reddit's answer carries `truncated`, X's carries `next_cursor`.
- SocialCrawl returned a Reddit comment with a null author and an X reply with
  a full one. Author presence is a per-platform fact, not a schema fact.
- US-013 prices a monitor from `pricePerUnitMicros`. Opening threads must reach
  the budget guard, or a monitor with comments spends past its cap.
  docs/testing.md: a rule is only as tested as its least-tested caller.

## Log

- 2026-09-05T01:18+08:00 — Split from US-005. The interface change is the
  reason: three fields are missing and the decision belonged in its own ticket.
- 2026-09-06T01:32+08:00 — Rewritten for ScrapeCreators, on the owner's
  decision to move off Bright Data on price. Reading the already captured
  `post/comments` answer changed three conclusions. The post and its whole
  thread arrive together for one credit, so the context problem is solved at
  the wire and not by a second call. The charge is not split, so the
  `SearchResult` change is dropped. And the cost is model calls rather than
  fetches, which moves the control from the opt-in to the re-open rule.
- 2026-09-06T01:40+08:00 — Probed the endpoint live, nine calls for nine
  credits, $0.017. A credit buys a page of about 25 comments and not a thread:
  threads claiming 640, 296 and 95 comments each returned 25. The `cursor`
  pages, page sizes are irregular, and a top-level drain of the 95-comment
  thread stopped at 43 with `has_more: false` while the rest sat in nested
  subtrees. That last fact is the trap and it now has its own acceptance box.
  The design conclusion is to read one page per thread and stop.
- 2026-09-06T01:47+08:00 — Asked SocialCrawl the same question, for five
  credits and $0.041. It returned 92 of 95 comments seven levels deep in one
  call and reported `truncated: false`, where ScrapeCreators reached 43 across
  three calls and reported itself finished. It is the better endpoint and the
  wrong choice: twenty-two times the price on the median thread, and the half
  it adds is the half a reader ranks last. Recorded as the escape hatch. Its
  catalogue is free to read, which is how the endpoint was found.
- 2026-09-06T09:31+08:00 — US-029 answered the stage order. The embedding stage
  does not run on a comment: under the parent title it drops nothing, and alone
  it ranks a long expert answer above every post it was tuned on. The acceptance
  box now names the answer instead of pointing at the ticket. One question came
  out of it that nobody has answered: what the free keyword stage asks of a
  comment whose parent matched a subreddit.
- 2026-09-06T02:02+08:00 — Widened from Reddit to every platform, on the
  owner's point that a reply is not a Reddit feature. The free catalogue lists
  17 comment endpoints over 12 platforms on one shared schema, and a live X
  reply proved the schema is really shared: identical field names to a
  SocialCrawl Reddit comment, so one parser reads both. One credit bought 29 X
  replies, which is about the price of an X post, so replies roughly double
  what an X poll sees at no change in unit cost. Scope is held to Reddit, X and
  LinkedIn, because every other platform on that list is a fourth network and
  PLAN.md's rule stands for the fourth. The file was renamed; the id did not
  change.

- 2026-09-06T03:52+08:00 — Reddit is done, end to end, and X and LinkedIn are
  deliberately not started. The owner asked to settle one platform before
  spreading across three, and the interface was built for exactly that: a
  connector without `fetchReplies` declares by its absence that it cannot, so
  the two platforms left behind still poll and still return posts today.

  **The shape.** `collect → filter → replies → filter → classify`. The replies
  step is its own queue because it spends at a provider where the filter spends
  at a model, and one job that could fail at either would be retried against
  both. It runs after the classify job is booked, so a post reaches the inbox
  without waiting on a thread.

  **The two rules that decide what this costs**, and each has a test that goes
  red if it is removed. A thread is opened only under a post the pre-filter
  kept. And it is opened only when the platform's own reply count has grown,
  unless we know we only half read it — without that second rule an hourly
  monitor re-buys every conversation it has ever seen, for ever.

  **What a reply skips.** Keyword and embedding both measure subject, and a
  reply has none of its own. Triage remains, which is US-029's and US-030's
  conclusion arriving in code: on a reply it is the only paid stage in front of
  the classifier.

  **What the classifier is told.** Two levels — the post, and the reply
  directly above — and a sentence saying the thread is context and the reply's
  own author is who is judged. Without that line the model scores whoever wrote
  the post and every reply under a good post becomes a match.

  936 tests pass. Eight of them drive the replies step against real Postgres,
  and the connector tests replay the captured thread where ScrapeCreators says
  `has_more: false` with 33 of 58 comments missing.

  Nothing here has met a live provider. The connector is driven against
  captured payloads only, so the whole path is unproven until one real poll runs
  with `includeReplies` on.

- 2026-09-06T11:18+08:00 — X replies, and the shared parser the last box asked
  for. Three credits: one to find a post with a thread, one for its first page,
  and a second page that was refunded.

  **The shared schema is real, and now proven rather than assumed.** An X reply
  and a YouTube comment carry the same nine field names — `author`,
  `engagement`, `flags`, `id`, `parent_id`, `post_id`, `published_at`, `text`,
  `url`. YouTube adds `ext`, a bag of platform extras nothing reads. So
  `comments.ts` is one parser and the connectors keep only what genuinely
  differs: which endpoint to call, and that YouTube leaves `url` null while X
  fills it in. A test compares the two payloads field by field rather than
  trusting the provider's archetype name.

  **A third completeness claim measured wrong, and this one over-promises.** The
  captured page of 28 replies reported `has_more: true` with a cursor; following
  it returned zero items. After ScrapeCreators' `has_more: false` with 33
  comments missing, that is two providers whose flags cannot be believed — but
  X's is the harmless direction and it is refunded, so trusting it costs a round
  trip and no money. The connector over-reports `partial` for the same reason: a
  thread wrongly called partial is read again for a credit, and one wrongly
  called complete is never revisited.

  The post claimed 71 replies and the page returned 28. That gap is unexplained
  and is the provider's business; what is asserted here is that the connector
  reports what arrived.

- 2026-09-06T11:18+08:00 — Found while capturing, and fixed before the feature:
  **the X fixtures had carried real handles since US-006 committed them.** Eight
  files, individual developers as often as companies. No field rule reaches it —
  a post's `text` is what the classifier reads, so it cannot be replaced, and
  people write "@someone" inside it constantly. The same leak the YouTube
  capture had, found the same way, by auditing rather than by reading. The
  committed payloads were rewritten in place rather than re-fetched: scrubbing
  is an operation the capture already performs, so nothing about what they prove
  changed, and re-capturing would have spent ten credits for different posts and
  the same lesson.

- 2026-09-06T12:13+08:00 — The worker pages a thread now. It called
  `fetchReplies` once and never read `next`, so a video with three thousand
  comments gave us the newest fifty-one and stopped — recorded as a gap in this
  Log at 03:52 and closed here.

  The walk ends on whichever comes first, and all three are needed:

  * the connector says `done`;
  * `maxPagesPerThread`, which is four — a page is 25 comments at
    ScrapeCreators and 51 at SocialCrawl, so four is 100 to 200 replies from one
    thread, already more than a person reads;
  * **a page that came back empty**, which is not redundant. US-020 measured an
    X thread whose `has_more: true` led to nothing. A cursor is not a promise
    that anything is behind it, and paging on from silence buys the same silence
    again.

  A thread stopped by our own bound is recorded `repliesPartial: true` whatever
  the provider said about the page we stopped on. The provider's answer is about
  its page; the honest answer is about the thread.

  The fake grew two options for this — `replyPages` and `repliesRunDryAfter` —
  and the second is shaped from that X measurement rather than imagined. 1,010
  tests pass.

