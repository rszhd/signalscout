---
id: US-287
title: A pair puts at most so many posts to the classifier a day
type: feature
priority: p2
created: 2026-09-21T17:55+08:00
parent:
area: pipeline
resolution: shipped
---

## Context

The hosted product sells checks a day (US-285 there). One check is one
query on one platform — a *pair* — and every pair may be polled hourly.
Its allowances are sized on 25 new posts a pair a day reaching the
classifier: $0.19 a pair a month at $0.00025 a post. Until now a daily poll
kept that number by accident, because one poll fetches at most
`maxPagesPerPoll` pages. Hourly polling removes the accident: 24 polls of
a busy query can bring 3,000 posts a day, and the first poll of any query
brings its whole backlog — measured live on 2026-09-21, one Reddit query's
first poll read 428 records and put about 300 posts to the model, twelve
days of the ceiling in one go.

The application already bounds the account: its scheduler gate refuses an
owner whose account has put `checks a day × 25` posts to the classifier in
a UTC day. What that cannot do is be fair between pairs — one busy query
takes the whole account's day and the quiet ones are read tomorrow — and it
cannot see a first poll coming, because the gate runs before the poll and
the posts arrive after. Both need the pipeline, which is where the posts
are handed to the classifier.

**A worker option, not a rule of the package.** The self-hosted product
runs on its owner's keys and reads every post it finds; nothing here changes
for it. The application passes `newPostsPerPairPerDay` the way it passes
`entitled` (US-153): unset means unlimited, which is what every instance has
today.

**A pair knows its posts.** `post_discoveries` (US-212) records which
monitor input found which post — `(monitor_id, post_id, source, kind,
value)`. "Which pairs found this post today" is a read of that table, and
"how many posts this pair put to the classifier today" is `model_calls` with
purpose `classification` joined to it over `(monitor_id, post_id)` since the
UTC day began. No new column and no new count to keep.

**The rule, at the door of `classify`.** When a poll hands newly collected
posts to the classifier, a post is admitted if at least one pair that found
it still has room today; an admitted post counts toward every pair that
found it, which is the truth — both searches earned it. A post admitted by
nobody is written to `filter_drops` under a new stage, `ceiling`, so the
Monitors screen counts it where it counts every other post the model did
not read, and a person who opens "What the AI reads" sees the number. It is
not classified later: the day's posts are the day's, and a backlog that
drained at 25 a day for twelve days would be the ceiling in name only.

**The first poll is the same rule.** A new query's first poll admits its
first 25 and drops the rest under `ceiling`. That is a smaller first day
than today's, on purpose: the alternative was the first poll spending the
account's whole day on one query and the gate holding every other query
until midnight.

**A reply page is one of the 25.** Reading replies is per new post and a
comment page is the dearest fetch this product makes ($0.0406 on Instagram
and on Reddit through SocialCrawl). So a page fetched for a post counts as
one against every pair that found the post, and a pair whose day is full
fetches no more pages that day. The `replies` worker asks the same count
before it fetches, with reply pages added: `api_usage` does not know the
post, so the pages are counted from `posts.replies_read_at` and the page
arithmetic the worker already does, over the same discoveries join.

**A day is the UTC day**, as the application counts it.

## Acceptance

- [x] `startWorker` takes `newPostsPerPairPerDay?: number`. Unset, nothing
      below runs and the suite's existing cases are unchanged.
- [x] `filterStages` gains `ceiling`, and the migration that widens
      `filter_drops_stage_known` ships in the same change (the rule in
      AGENTS.md about a value added to a check constraint).
- [x] One function answers "which of these posts may this monitor put to
      the classifier now": it reads each post's pairs from
      `post_discoveries`, each pair's count today from `model_calls` joined
      over `(monitor_id, post_id)` with `created_at` since the UTC day
      began, admits a post while any of its pairs has room, and counts an
      admitted post against every pair that found it. Written test-first:
      it is the bound the application's allowance rests on.
- [x] `classify` calls it at the door and writes a `filter_drops` row with
      stage `ceiling` for every post it refuses. A refused post keeps its
      `posts` and `post_discoveries` rows.
- [x] A post refused today is not classified tomorrow. `ceiling-steps.test.ts`
      proves a later job handed the same ids asks the model for nothing, and
      `ceiling.test.ts` that the count starts again at the UTC midnight.
- [x] The first poll of a new query with a backlog classifies the number
      and drops the rest under `ceiling` — 30 in, 25 read, 5 dropped in
      `ceiling-steps.test.ts` — and the Monitors screen's "What the AI reads"
      counts them: "275 were past the day's limit for the search that found
      them", with the filter on or off.
- [x] The `replies` worker asks the same count with reply pages included
      before opening a thread and before each page, and a pair whose day is
      full opens none. `ceiling-steps.test.ts` proves a spent pair's thread
      is not opened while a pair with room is.
- [x] A post found by two pairs counts against both, and is admitted while
      either has room. A post found by a `channel` discovery (a subreddit)
      counts against the channel as a pair of its own.
- [x] `docs/costs.md` says the ceiling exists, that it is off unless an
      application sets it, and what the `ceiling` stage means on the screen.
- [x] `docs/releasing.md` names the version; the application pins it
      (US-285 there ticks its two pipeline boxes). 0.12.0, cut 2026-09-21.

## Notes

- `packages/pipeline/src/worker/classify.ts`, `worker/replies.ts`,
  `worker/runtime.ts` (the option), `db/schema/vocabulary.ts`
  (`filterStages`), `db/schema/ledgers.ts` (`filter_drops`),
  `db/schema/posts.ts` (`post_discoveries`), `docs/costs.md`.
- The application's half: `signalscout-cloud`, US-285, `plans.ts`
  (`newPostsPerPairPerDay = 25`) and `worker.ts`, which passes it.
- Why `model_calls` and not a counter: a counter is a second fact that can
  disagree with the ledger; the ledger already knows every classification
  and which post it was.
- Why the day's posts are the day's: a backlog drained at 25 a day is the
  ceiling in name only, and the posts are not lost — they are stored, and
  the drop row says why they were not read.

## Log

- 2026-09-22T03:25+08:00 — Cut as 0.12.0 and pinned. Shipped.

- 2026-09-21T19:40+08:00 — Built on `feature/us-287-pair-ceiling`.
  `worker/ceiling.ts` holds the rule and `ceiling.test.ts` its eight cases,
  written first; `ceiling-steps.test.ts` drives the two doors. Migration
  0066 widens `filter_drops_stage_known` for `ceiling`; the API and the
  detail page carry the fourth count. 127 files, 2,289 tests pass. Nothing
  has run live. What the ticket does not do: a reply page bought by an
  earlier job today is not in the persisted count — the tally moves inside a
  job, and across jobs the ledger sees the pages through the replies they
  stored and the classifier read. Written down as the approximation it is.
  The release box waits for the owner.

- 2026-09-21T17:55+08:00 — Written from the hosted product's US-285, after
  a live first poll showed one query putting 300 posts to the model. The
  account bound is theirs; the per-pair bound and the reply page are ours.
