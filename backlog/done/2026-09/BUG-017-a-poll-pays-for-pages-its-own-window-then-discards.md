---
id: BUG-017
title: A poll pays for pages its own window then discards
type: bug
priority: p1
created: 2026-09-10T10:44+08:00
parent:
area: worker
resolution: fixed
---

## Context

**`monitors.last_polled_at` answers two questions and only one of them is
about a window.** The poll interval needs "when did a job last run". The search
window needs "how far forward does our collection already reach". One column
holds both, and it moves at the *start of every poll* — including the resumes
of a collection that is still being walked. So by the time one walk ends, that
mark is minutes fresh while the walk's own coverage ended long before, and the
**next** walk is started with a window as narrow as the gap between two polls.

**A walk is long and a poll is short, which is what makes the gap bite.** The
SocialCrawl Reddit connector turns five queries across eight subreddits into
**forty (query, subreddit) pairs**, and `maxPagesPerPoll = 5` means one poll
buys five pages. A walk therefore takes eight or more polls, and it re-books
itself immediately — `resumeAfter: now` when the page cap stops it. A monitor
in that state polls in a tight loop, and each new walk inherits a window a
minute wide, then spends eight polls buying forty inputs against it. Every page
is fetched, billed, and dropped by the connector's own `since` filter.

**What is already right, and is worth not breaking.** `rememberContinuation`
writes `since` **once and never updates it**, and its comment says why: the
window belongs to the poll that triggered the collection, and a resume that
moved it would read a snapshot with a question it was not collected for. So one
walk keeps one window. The fault is not inside a walk. It is at the seam
between two.

**Measured live on the production instance, 2026-09-10.** Two consecutive polls
logged:

```
sourceId=reddit  resumed=true  pages=5  posts=0  unitsConsumed=5
```

Five pages, five credits, **zero posts**, twice. `source_continuations` held
one row: cursor `scoped|22|0` — input 22 of the 40 — with
`since = 2026-09-09 19:48:45`, which is the moment the *previous* poll of the
original run started. That is the inherited window, still filtering pages
bought seven hours later.

**The searches themselves are full.** The same forty pairs run against the same
endpoint with **no window** returned **125 posts in 5 pages for 5 credits**. So
the pages are not empty; the window empties them.

**The first run cost $0.666 and stored nothing.** On 2026-09-09 the monitor
polled fifteen times inside ten minutes, billing 67 Reddit credits and 15 X
credits. Fifteen polls one minute apart is the tight loop this describes.

**One thing is not explained and must not be claimed.** The *first* poll of
that run had no window at all — `createMonitor` never writes `last_polled_at`
— so it should have collected. It stored nothing, and this ticket does not say
why. BUG-016 is one candidate and the account is another. Fixing this ticket
will not on its own prove the production monitor collects.

**There is a second, cheaper half, and it is parked.** Even with the window
right, this connector fetches a page and then discards it locally, because the
provider refuses a `timeframe` beside `sort=new`. Where a page comes back
newest-first and its *whole* page is older than the window, the walk could stop
that input rather than buy its second page — the early-stop rule US-061 uses on
SocialData and US-028 deliberately omits on LinkedIn, where the order is
relevance. That needs a capture proving this endpoint orders a whole page, and
a wrong guess there drops posts silently where the current code merely pays.

## Acceptance

- [x] A new walk is started with the window the previous walk *finished* at,
      not with the time of the last poll job
- [x] The mark a window is taken from advances only when a walk completes, so a
      poll that resumes one does not move it
- [x] `monitors.last_polled_at` keeps meaning "when a job last ran", so the
      interval and `findDueMonitors` are untouched
- [x] A monitor that has never polled still collects with no window at all
- [x] A test drives two walks over several polls and asserts the second walk's
      window is where the first one finished — it fails on the current code
- [x] A test asserts a resume does not move that mark, which is the half that
      makes the first one true
- [x] The window a walk is pinned to survives a worker restart, because it
      lives in `source_continuations` and not in the job
- [x] `poll_runs` shows the difference: a walk that used to return zero posts
      for five credits a poll returns posts for the same credits
- [x] Measured, not argued: one live run of the production monitor's own plan,
      with the pages bought and the posts stored both recorded

## Notes

- Do not fix this by not advancing `last_polled_at`. The interval is measured
  from poll starts, and a monitor that stopped moving that mark would be polled
  again immediately and forever. The repair is a **second** mark for coverage,
  not a change to what this one means.
- Do not touch `rememberContinuation`'s write-once `since`. That is the rule
  that keeps one walk on one question, and it is already correct.
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
- 2026-09-10T10:52+08:00 — Context rewritten. The first version said a walk
  narrows its own window on every step. That is wrong: `rememberContinuation`
  writes `since` once and never updates it, so a walk keeps its window. The
  fault is at the seam between two walks, where the new one inherits a window
  one poll-interval wide. The symptom, the money and the measurements are
  unchanged; the mechanism is not.
- 2026-09-10T13:55+08:00 — Fixed. `source_coverage` is the second mark, one
  row per (monitor, platform), migration 0058. A row is written when a **walk**
  finishes and it holds the moment that walk *started*, never the moment it
  ended: a walk collects up to its own beginning, and anything written while it
  paged may have been missed. Erring early is the safe direction, because
  `posts` deduplicates — a window that is too wide costs a page and a window
  that is too narrow loses posts with no trace. `greatest()` in the upsert
  stops the mark ever moving backwards.

  `monitors.last_polled_at` is untouched and still means "when a job last ran",
  so the interval and `findDueMonitors` are exactly as they were.

  The migration seeds every monitor that has already polled, from
  `last_polled_at` — which is what the window used to be — so the first poll
  after the upgrade behaves like the last one before it. Without that seed,
  every monitor would open one unwindowed walk per platform at a provider that
  bills the page.

  Three mutations turn the suite red: reading the poll mark as a window again,
  recording nothing when a walk finishes, and marking the walk's end rather
  than its start.

  **Three existing tests changed, and none of them by weakening an
  assertion.** Each one set up or reset the window through `last_polled_at`,
  which is no longer where a window comes from; the claims they protect — a
  resume asks its trigger's window, a provider switch takes effect on the next
  collection, a repeated page buys no model call — are asserted unchanged.

  **Two boxes stay open and both need a live run.** Nothing has polled a real
  provider through this, so the row that would show the difference is
  unmeasured. The production monitor is the case to run it on.
- 2026-09-10T14:35+08:00 — Measured live against SocialCrawl, on the
  production monitor's own plan. Three polls of one walk: **125 posts returned
  and 104 stored new**, then 100 and 95, then 125 and 109 — **308 new posts for
  14 credits, $0.1137**. Where the same plan stored nothing.

  The walk boundary is proven both ways. All three polls carried one `walk_id`
  and wrote **no coverage row**, because the walk was still paging — which is
  the half that makes the other half true. A second probe on one (query,
  subreddit) pair finished its walk inside one poll, wrote its coverage mark,
  and the next poll opened a **new walk id**.

  What the live run does *not* discriminate is the mark's value: the probe's two
  walks were two seconds apart, so the previous walk's start and the last poll's
  time are the same number there. That claim rests on the unit test.

  Migration 0058 applied to the production database with a collection in flight
  and seeded both platforms from `last_polled_at`, so the box about surviving an
  upgrade is closed by a real upgrade rather than by a test.
