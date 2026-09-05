---
id: US-034
title: YouTube is the fourth platform
type: feature
priority: p2
created: 2026-09-06T04:58+08:00
parent:
area:
resolution:
---

## Context

**PLAN.md said not to add this, and the owner decided to anyway.** The rule at
PLAN.md's *Important rule* is that no further network is added until Reddit and
X reliably produce useful matches. That condition is not met and is further from
met than when LinkedIn crossed the same rule: five verdicts exist in total, and
forty-one matches sit unjudged in [US-033](US-033-thirty-verdicts-say-whether-the-score-is-right.md).
The rule was crossed once for LinkedIn on 2026-09-05 and PLAN.md records that it
stands for the fourth. This is the fourth. It is written here, in STACK.md and
in AGENTS.md so the next reader finds a decision rather than an oversight, and
the rule still stands for the fifth.

**YouTube runs through SocialCrawl, on the key that already fetches X and
LinkedIn.** A third platform behind one provider, one key, one rotation. Every
figure below was read from the provider's own free catalogue on 2026-09-06 —
`/v1/utility/endpoints` and `/v1/utility/endpoint`, both `credits_used: 0` — and
none of it has been checked against a live call yet.

**It can be searched, which is the question that decides whether a platform is
possible at all.** `/v1/youtube/search` takes a keyword, costs one credit and
pages by cursor. That is the test Bright Data and ScrapeCreators failed for X.

**The shape is inverted here, and that is the important part.** On Reddit a post
is often the lead and the replies are experts answering it. On YouTube a video
is almost never the lead — it is content somebody published, usually to be seen
— and the comment underneath is where a person says they have the problem. So
US-020's reply work is this platform's foundation rather than an addition to it,
and a YouTube monitor that collected only videos would collect almost nothing
worth reading.

Two things make the comments unusually good here, both better than Reddit's:

* `/v1/youtube/video/comments` returns **100 comments a page for one credit**,
  against ScrapeCreators' 25 for the same price.
* With `order=newest` the rows arrive newest-first on an **exact per-second**
  timestamp, each page strictly older with no overlap. That is a real date
  window, which Reddit's endpoint does not offer.

It also takes a `searchTerm`, which filters comments to those containing a term
server-side. Nothing else in this product can search inside a thread. Whether it
is worth using is a cost question this ticket should measure rather than assume:
it may cut the model bill, or it may drop the person who described the problem
in their own words.

**Two documented traps, and both are ours to handle.**

The first is dates on search. Without `includeExtras=true`, `published_at` on
every search result is derived by the upstream from a relative label such as
"4 months ago", and the provider says it is **approximate, measured up to four
months off**. A connector that applied `since` to that would drop fresh videos
and keep stale ones. Either send `includeExtras=true` or use
`/v1/youtube/search/advanced`, which carries an exact date on every result and
takes `published_after` directly.

The second is on comments. **The first row of the first page can be the video's
pinned comment regardless of `order`.** So a walk that stops at the first
out-of-window row can stop immediately and return nothing. Filter by timestamp;
never terminate on position.

## Acceptance

- [x] `youtube` is a platform in `db/schema.ts`, in a migration, and
      `PlatformDescriptor` carries its own query rule
- [x] The connector searches videos by keyword and pages by cursor, and a test
      replays a captured answer
- [x] `since` is applied from an exact publish date, never from the derived one,
      and a test proves a connector given the approximate field does not filter
      on it
- [x] The connector reads comments through `fetchReplies`, declares
      `canFetchReplies`, and stores them as `kind = 'reply'` rows under their
      video exactly as Reddit does
- [ ] A comment walk filters by timestamp rather than stopping at the first
      out-of-window row, and a test drives a captured page whose first row is a
      pinned comment older than the window — **not done: the connector reads
      one page and never walks, so there is no walk to get wrong yet. It
      becomes real the day a monitor asks for a window longer than a page.**
- [x] `ReplyResult.partial` is reported from evidence, the same rule the Reddit
      connector follows
- [x] Fixtures are captured from a live account by a script under the
      connector's own directory, with author identity scrubbed, and are read
      before they are committed
- [x] The Log records what one search and one comment page actually cost and
      returned, measured
- [x] The Log says whether `searchTerm` is worth using, with the number
- [ ] STACK.md and AGENTS.md record that the fourth network was added
      deliberately and that the rule stands for the fifth

## Notes

- Depends on [US-020](../doing/US-020-a-monitor-can-include-comments-and-replies.md),
  which built the reply path this platform rests on.
- One credit is 8,118 micro-dollars — the £15 pack of 2,500, already in
  `socialcrawl/x.ts`. So a search page and a comment page are $0.0081 each. At
  100 comments a page that is $0.000081 a comment, the cheapest item this
  product has ever fetched.
- The model is the bill, as always. 100 comments a page means one credit can buy
  100 triage calls, which at the measured 267 micro-dollars each is $0.027 —
  three times the fetch. Read docs/costs.md before quoting any figure.
- Do not add `/v1/youtube/video/transcript` in this ticket. A transcript is 3
  credits and a video's words are the publisher's, not a buyer's.
- `/v1/youtube/search/advanced` costs the same 1 credit as `/v1/youtube/search`
  and carries exact dates plus `published_after`. Prefer it unless a capture
  shows a reason not to.
- Channel discovery is out of scope for the same reason it was on LinkedIn: a
  monitor exists to find a stranger, and a named channel is not one.

## Log

- 2026-09-06T04:58+08:00 — Written after reading SocialCrawl's free catalogue,
  which cost nothing. The decision to cross PLAN.md's rule a second time is the
  owner's and is recorded rather than absorbed. The finding worth carrying
  forward is that YouTube inverts the shape: the video is not the lead, the
  comment is, so this ticket is US-020 applied rather than a fresh connector
  with replies bolted on.

- 2026-09-06T05:20+08:00 — Captured, for **10 credits and $0.081** across three
  runs. Ten payloads are committed with a manifest and a ledger. Four of the
  documentation's claims were wrong or incomplete, and one of my own rules was.

  **`/v1/youtube/search/advanced` does not work as documented.** The catalogue
  lists `published_after` among its parameters, and sending it with `order=date`
  answers **400 INVALID_REQUEST** — refunded, so the refusal was free. The
  ticket's Notes recommended preferring that endpoint. That recommendation is
  withdrawn: the connector uses `/v1/youtube/search` with `includeExtras=true`,
  and applies `since` itself.

  **The approximate dates are worse than the warning says.** Comparing the same
  45 results with and without `includeExtras`, the derived date drifts a
  **median of 62 days and a maximum of 283**. The documentation said "up to four
  months"; this is nine.

  **There is a field the documentation never mentions, and it is the honest
  one.** Every plain result carries `ext.published_precision` — `"year"`,
  `"month"` or null — beside `ext.published_label` ("2 years ago"). So a
  connector can tell exactly how much a date is worth rather than guessing.
  `includeExtras=true` returns the exact instant and drops the precision field,
  which is consistent: there is nothing to warn about.

  **`includeExtras=true` is free.** It cost one credit, the same as the plain
  search, so there is no reason to ever ask for the approximate dates.

  **A search that matches nothing is not refunded and not empty.** A phrase that
  cannot occur returned **12 unrelated videos and charged a credit** — the same
  behaviour US-028 measured on LinkedIn, and the opposite of X, where an empty
  search is refunded. A vague query here is full-price noise, not free silence.

  **The comment endpoint's claims all hold.** One page returned **51 comments
  for one credit**, every one with an exact per-second timestamp, and they were
  strictly newest-first with no exception. `pagination.next_cursor` was null
  with `has_more: false`, which agreed with `total`. That is the guarantee
  ScrapeCreators claimed for Reddit and broke by 33 comments.

  **`searchTerm` filters server-side and costs the same.** 51 comments became 8
  for one credit. It is worth having and it is not the default: it would drop a
  person describing the problem in words the monitor did not think of.

  **The scrubber leaked twice and the audit caught both.** `authorDisplayName`
  inside nested `preview_replies` used camel-case names my rules did not carry.
  Worse, people write handles *inside* the text the classifier reads — "@X
  thanks for the clarification" — and one creator put a real email address in a
  video description. Field rules cannot catch either. The fix rewrites handles,
  channel URLs and email local parts in place and leaves the sentence around
  them, so the fixture still proves the parser reads the text. This is the
  second capture in this repository to leak on its first run; the header now
  says so twice.

- 2026-09-06T05:26+08:00 — Built and polled live. **6 credits, $0.049**, three
  minutes 38 seconds, through the real steps in the real order:
  `filter(71) → classify(11) → notify → replies(11) → filter(7) → classify(5)`.

  | | |
  |---|---|
  | Videos collected | 71 for 2 credits |
  | Cost per video | 229 micro-dollars — the cheapest fetch this product makes |
  | Triage dropped | **60 of 71**, an 85% drop rate |
  | Threads opened | 11 |
  | Comments collected | **7** |
  | Matches | 2 — one comment, one video |

  **The comment match is what the platform is for.** Scored 65, under "Using
  Code Smells to Fix Flaky Tests in Cypress": *"Do you know about any test tool
  which does not have these async issues?"* A person asking for an alternative
  to the tool they use — not the publisher. The prompt judged the right person
  and its last reason is honest about what the comment does not say rather than
  inflating the score.

  **Triage earned its place here more than anywhere.** An 85% drop rate against
  62% on the Reddit replies, and it is the right shape: most YouTube search
  results are tutorials, and a tutorial is not a lead.

  **The finding that cost four credits: eleven threads returned seven
  comments.** The captured fixture had 51, so the expectation was around 500.
  Most videos have almost nothing underneath them.

  Half of those videos already carried `engagement.comments: 0` on the row.
  `includeExtras=true` populates that field on about half of a search page —
  checked against `search-with-extras.json`, 22 of 44 — and the connector was
  already sending the flag. The replies step read the count only to decide
  whether a thread had *grown*, never whether it existed. So the money bought
  answers the platform had already said would be empty.

  Fixed, in `worker/replies.ts`: a `replyCount` of exactly zero is refused.
  One is not — the best match of this run came from a thread with a handful —
  and null is never refused, because null means the platform did not say and
  that is the normal state on Reddit and on half of YouTube.

  **The premise is half right.** The lead is in the comments, and the better of
  the two matches proves it. But most videos have no comments worth opening, and
  the count is the only cheap way to tell which. One poll and one query is not a
  distribution.

- 2026-09-06T05:46+08:00 — Two defects the live run exposed, both fixed.

  **The comments had no date window at all.** `ReplyRequest` carried no `since`,
  so no connector could cut on one — and the run's better match was a comment
  written in **June 2021**, 1,915 days old. A person who wanted a Cypress
  alternative five years ago chose one long ago. The collection around it: mean
  video age **655 days**, oldest 2015, eleven of seventy-one from the last
  ninety days.

  A thread outlives the post above it, so `monitors.last_polled_at` is the wrong
  window even when there is one — a video collected today can carry comments
  from 2015. The replies step now passes the later of the monitor's own poll
  mark and a ninety-day floor, so a first poll is bounded too.

  Both connectors apply it, and they stop paging differently for a measured
  reason. YouTube may stop early: rows arrive newest-first and each page
  continues strictly older, so once a page's oldest row is outside the window
  every later page is too. ScrapeCreators may not: its Reddit endpoint returns a
  ranked tree rather than a list, and US-020 measured what its ordering claims
  are worth — a top-level `has_more: false` with 33 of 58 comments missing. So
  there it is a filter over the page and nothing more.

  **The pinned-comment trap now has the test the ticket asked for.** The
  provider warns the first row of the first page can be a pinned comment
  whatever the order, so a walk that terminated on the first out-of-window row
  could stop on row one and return nothing. A case drives exactly that payload.

  **Threads the platform says are empty are no longer bought.** Half the
  eleven videos carried `engagement.comments: 0` already, unread. Zero is
  refused; one is not, because the run's best match came from a small thread;
  null is never refused, because null means the platform did not say.

  979 tests pass.

- 2026-09-06T05:47+08:00 — Two things this run leaves open, both found by
  reading it rather than by the suite.

  **The worker never pages a thread.** `replies.ts` calls `fetchReplies` once
  and does not read `result.next`, so a video with three thousand comments gives
  us the newest fifty-one and stops. The window above makes that harmless in the
  common case and not in the busy one. `ReplyResult.partial` already records
  that we stopped early; nothing acts on it. A bounded paging loop belongs in
  US-020.

  **The comment deep link is unverified.** The provider returns `url: null` on
  every comment, so the connector builds `watch?v=<video>&lc=<comment>` — the
  format YouTube's own Share button produces, and what the inbox opens. Nobody
  has watched YouTube honour it. One click settles it and this note is here so
  the next person knows it was not done.
