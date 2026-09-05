---
id: US-020
title: A monitor can include Reddit comments
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

This ticket was rewritten on 2026-09-06. It was written against Bright Data.
It now builds on ScrapeCreators, and three of its original conclusions were
wrong for that provider.

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

**The charge is not split, and the interface should not be either.** The
original acceptance list asked `SearchResult` to report each kind of read
apart. That existed to make Bright Data's second charge visible. Here there is
no second charge: one credit covered the post and the thread. Adding the field
now would shape the interface around the provider we are leaving.
`unitsConsumed` stays one number and it is correct.

Only one provider can do this. A deployment holding a Bright Data key must be
told that comments are unavailable, not quietly given none.

## Acceptance

- [ ] `SourceQuery` carries an opt-in for comments, and a connector that cannot
      fetch them ignores it rather than failing
- [ ] A connector declares whether it can fetch comments, and the monitor form
      reads that declaration, so a deployment whose Reddit provider cannot
      fetch comments is told so instead of being given none
- [ ] The fake source can be told to return a thread, so callers are tested
      without a network and without a bill
- [ ] The ScrapeCreators Reddit connector fetches a thread by post URL when the
      opt-in is set, and never when it is not
- [ ] A comment is stored as its own row, keyed by its `t1_` fullname, with a
      link to its parent post and to its parent comment
- [ ] A thread is opened only for a post that survived the pre-filter, and the
      number of threads one poll may open is bounded
- [ ] `num_comments` is stored on the post at collection, and a thread is
      re-opened only when that number has grown
- [ ] The classifier is given the parent post title and the immediate parent
      comment, and the prompt says the thread is context and the comment author
      is who is being scored
- [ ] A monitor stores the opt-in, in a migration that keeps it off for every
      existing monitor
- [ ] The monitor form shows the opt-in, says what it costs in model calls
      rather than in fetches, and leaves it off by default
- [ ] The inbox shows the parent post title above a comment match and links to
      the comment permalink, so a person sees the context the model saw
- [ ] Tests replay comment payloads captured by
      `sources/providers/scrapecreators/fixtures/capture.mjs`, extended with a
      comments mode
- [ ] One page is read per thread by default, and the number of pages a poll
      may buy is bounded
- [ ] A top-level `has_more: false` is never stored or logged as "the thread is
      complete", and a test proves a partly read thread is recorded as partial
- [ ] Whether the embedding stage runs on a comment follows
      [US-029](US-029-a-measurement-says-which-pre-filter-fits-a-comment.md)

## Notes

- Depends on [US-005](../done/2026-09/US-005-reddit-returns-candidate-posts.md)
  and [US-025](../done/2026-09/US-025-reddit-has-a-second-provider.md).
- Blocked on [US-029](US-029-a-measurement-says-which-pre-filter-fits-a-comment.md)
  for the stage order only. Everything else can be built before it answers.
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
