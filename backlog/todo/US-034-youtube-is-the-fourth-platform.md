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

- [ ] `youtube` is a platform in `db/schema.ts`, in a migration, and
      `PlatformDescriptor` carries its own query rule
- [ ] The connector searches videos by keyword and pages by cursor, and a test
      replays a captured answer
- [ ] `since` is applied from an exact publish date, never from the derived one,
      and a test proves a connector given the approximate field does not filter
      on it
- [ ] The connector reads comments through `fetchReplies`, declares
      `canFetchReplies`, and stores them as `kind = 'reply'` rows under their
      video exactly as Reddit does
- [ ] A comment walk filters by timestamp rather than stopping at the first
      out-of-window row, and a test drives a captured page whose first row is a
      pinned comment older than the window
- [ ] `ReplyResult.partial` is reported from evidence, the same rule the Reddit
      connector follows
- [ ] Fixtures are captured from a live account by a script under the
      connector's own directory, with author identity scrubbed, and are read
      before they are committed
- [ ] The Log records what one search and one comment page actually cost and
      returned, measured
- [ ] The Log says whether `searchTerm` is worth using, with the number
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
