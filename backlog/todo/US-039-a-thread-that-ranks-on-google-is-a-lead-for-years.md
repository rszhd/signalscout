---
id: US-039
title: A thread that ranks on Google is a lead for years
type: spike
priority: p2
created: 2026-09-06T12:32+08:00
parent:
area:
resolution:
---

## Context

**This product only knows how to ask "what was said recently".** Every
connector sorts by new, every poll carries a `since`, and US-020 added a
ninety-day window to replies for a good reason — a comment from June 2021
reached the inbox as a lead and the person who wrote it had chosen a tool years
before.

**That rule is right for a feed and wrong for a search result.** A Reddit
thread ranking first on Google for *"best flaky test tool"* is read by buyers
every day, for years. It does not decay. Its age is not evidence against it —
its age is why it ranks. Everything this product currently does would either
never find that thread or actively drop it: recency discovery misses it, and
the date windows would refuse it.

So the question is not "what is being said" but **"what do buyers find when
they go looking"**. Those are different sets and the second is the one with
commercial intent in it, because the queries that rank threads are the queries
PLAN.md's signal list describes: *alternative to X*, *best Y for Z*, *X vs Y*.

**It is a discovery mode, not a platform, and that distinction is the whole
design.** A Google result for a Reddit thread is a Reddit URL. This product
already fetches Reddit posts, already reads their comments, already
deduplicates them by `(source, external_id)`. Nothing new is stored and no
fifth network is added — PLAN.md's *Important rule* is not touched, because the
platforms are the four already integrated. What is new is a way of choosing
*which* posts to fetch.

**The provider already has it, on the key this deployment holds.** Read free
from SocialCrawl's catalogue on 2026-09-06:

* `/v1/google/search` — **1 credit**, paginated, takes `query` with `region`
  and `date_posted`.
* `/v1/search/forums` — 10 credits, takes `query` with `sources`, `exclude`,
  `timeframe` and a `comments` option. Aimed squarely at this product's
  purpose, and five times the price.

Neither has been called. Everything above is a catalogue entry and a
hypothesis.

**Three things could go wrong, and the ticket exists to find out which do.**

The result may be mostly the wrong shape: listicles, vendor blogs and SEO
pages rather than a person describing a problem. `site:reddit.com` narrows it,
and whether the endpoint honours an operator is unmeasured.

The threads may rank *because* they are answered. A question that got a good
answer three years ago is a thread where the buyer has already left, and the
people in the comments are the experts triage exists to drop.

And it fights the date window on purpose, so nothing here may reuse the
reply window without deciding to. A SERP-discovered thread wants its whole
comment history, not the last ninety days — and that is a cost as well as a
choice.

## Acceptance

- [ ] `/v1/google/search` is called for two or three monitor-shaped intent
      queries, and the whole answer is captured as a fixture with identity
      scrubbed
- [ ] The Log says what it cost, and whether an operator like `site:reddit.com`
      is honoured
- [ ] The Log counts, **by reading them**, how many results are a person
      describing a problem rather than a listicle, a vendor page or an SEO
      farm
- [ ] The Log says how old the ranking threads are, because age is the whole
      hypothesis
- [ ] `/v1/search/forums` is called once with the same query, and the Log says
      whether five times the price buys five times the signal
- [ ] The Log answers one question in a sentence: is a ranking thread a better
      lead than a recent one, and how would we know
- [ ] The Log records what it would take to fetch a discovered URL through the
      existing connectors — whether they can fetch by URL at all, which not all
      of them can
- [ ] If the decision is to build, a separate ticket does it. This one adds no
      discovery mode

## Notes

- Depends on nothing. One credit a search.
- The date window is the tension to hold, not to resolve quietly.
  `defaultReplyWindowDays` is 90 and a SERP thread is likely older than that on
  purpose. If this is built, the window becomes a property of the discovery
  mode rather than a constant, and that is a real change to
  `worker/replies.ts`.
- Not every connector can fetch one post by URL. ScrapeCreators has
  `/v1/reddit/post`, and the search-based connectors do not obviously have an
  equivalent. Check before assuming a discovered URL is fetchable.
- A thread that ranks may be years old and still open. `posts.postedAt` would
  make it sort to the bottom of the inbox, because US-011's ordering subtracts
  twelve points a day. A lead that is good *because* it is old would be
  invisible under that rule. Say so in the Log; do not fix it here.
- Do not reach for `/v1/web/search` or `/v1/search/everywhere` first. They are
  2 and 20 credits, and the cheap endpoint answers the question this ticket
  asks.

## Log

- 2026-09-06T12:32+08:00 — Written after the owner asked for it. The framing
  that makes it worth doing is that this is a discovery mode rather than a
  platform: a Google result for a Reddit thread is a Reddit URL, and everything
  downstream already handles those. The framing that makes it risky is that a
  ranking thread is old on purpose, and this product spent today teaching itself
  to distrust old things.
