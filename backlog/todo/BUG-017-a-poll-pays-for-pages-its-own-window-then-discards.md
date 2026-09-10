---
id: BUG-017
title: A poll pays for pages its own window then discards
type: bug
priority: p1
created: 2026-09-10T10:44+08:00
parent:
area: worker
resolution:
---

## Context

**A long walk narrows its own window on every step, so the pages it buys near
the end are almost always empty.** `collect.ts` moves `monitors.last_polled_at`
to now at the start of every poll, and a source that is *not* resuming a
collection is read with `since = last_polled_at` — the previous poll's time. A
walk that takes many polls therefore asks its later inputs for posts newer than
a few minutes ago, and a keyword search sorted by `new` has nothing that
recent. The page is fetched, billed, and then dropped by the connector's own
`since` filter.

**Measured live on the production instance, 2026-09-10.** The monitor's Reddit
plan is five queries across eight subreddits, which the SocialCrawl connector
walks as **forty (query, subreddit) pairs** at `maxPagesPerPoll = 5` a poll — so
the walk needs many polls to finish. Two consecutive polls logged:

```
sourceId=reddit  resumed=true  pages=5  posts=0  unitsConsumed=5
```

Five pages, five credits, **zero posts**, twice. The continuation sat at
`scoped|22|0` with `since = 2026-09-09 19:48:45`.

**The searches are not the problem, and that is measured too.** The same forty
pairs run against the same endpoint with **no window** returned **125 posts in
5 pages for 5 credits**. The pages are full. The window is what empties them.

**The first run cost $0.666 and stored nothing.** On 2026-09-09 the same
monitor polled fifteen times, one minute apart, billing 67 Reddit credits and
15 X credits. Every poll after the first read its new inputs against a `since`
about sixty seconds old.

**A resumed input is already right, and that is the shape of the fix.**
`rememberContinuation` stores the window the collection started with, and
`const window = continuation ? continuation.since : since` reads it back — the
comment above it says exactly why: *reading `last_polled_at` here would ask for
posts newer than the trigger, and every record the collection was paid for
would be filtered away as old.* That reasoning is correct and it stops one
input short. The **walk** has the same property as one input: it is one
question, asked over several polls, and the moment it started is the moment its
window should be pinned to.

**There is a second, cheaper half.** Even with the window pinned, this connector
fetches a page and discards it locally. `since` is applied by us on Reddit
because the provider refuses a `timeframe` beside `sort=new` (US-025 measured
that for ScrapeCreators). Where a page comes back sorted newest-first and its
**whole** page is older than the window, the walk can stop that input instead of
buying its second page — the early-stop rule US-061 uses on SocialData and
US-028 deliberately omits on LinkedIn, where the order is relevance. Whether
this endpoint's `sort=new` really orders the whole page has to be measured
before anything relies on it.

## Acceptance

- [ ] A walk that spans several polls asks every one of its inputs against the
      window the walk started with, not the previous poll's time
- [ ] A monitor that has never polled still collects with no window at all, and
      the first poll of a later walk uses the mark the previous walk finished at
- [ ] A test drives a multi-poll walk over several inputs and asserts the later
      inputs receive the first poll's window — it fails on the current code
- [ ] The window a walk is pinned to survives a worker restart, because it
      lives in `source_continuations` and not in the job
- [ ] `poll_runs` shows the difference: a walk that used to return zero posts
      for five credits a poll returns posts for the same credits
- [ ] Measured, not argued: one live run of the production monitor's own plan,
      with the pages bought and the posts stored both recorded

## Notes

- Do not fix this by not advancing `last_polled_at`. The interval is measured
  from poll starts, and a monitor that stopped moving that mark would be polled
  again immediately and forever.
- The early-stop half belongs in its own ticket if it is taken: it needs a
  capture proving `sort=new` orders a whole page on
  `/v1/reddit/subreddit/search`, and a wrong guess there silently drops posts
  rather than merely paying for them. Paying is the cheaper failure.
- Forty pairs at five pages a poll is its own question. `maxPagesPerPoll`
  bounds one job's spend and was never meant to bound a walk's length; a
  monitor with eight queries and eight subreddits would walk sixty-four inputs.
  US-014's cost test projects from one query and says nothing about the cross
  product.
- The 125-post measurement was taken with a different SocialCrawl account from
  the production one. The endpoint and the plan were identical, and the
  difference this ticket rests on is the window rather than the key — but that
  is one account against one account, so say so.

## Log

- 2026-09-10T10:44+08:00 — Found by triggering a poll on the production
  instance and watching the log, then reading `source_continuations`. Two polls
  bought five pages each and stored nothing; the same forty pairs with no
  window returned 125 posts in five pages.
