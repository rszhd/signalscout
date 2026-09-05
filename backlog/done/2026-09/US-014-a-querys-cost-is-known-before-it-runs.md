---
id: US-014
title: A query's cost is known before it runs
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

On a metered source the money is spent at fetch time, before any filter or
model sees the text. So the pre-filter cannot save a user from a bad query.
Only a better query can.

A user writing a monitor has no way to tell a narrow query from a broad one.
The word that seems specific to them may be common on X. They find out from
the invoice.

This adds a test step to monitor creation: run the query once against a small
sample, show how many posts it would return per day and what that costs at the
source's price, then let the user narrow it before the monitor starts.

The step itself costs money, which is the honest tension in this ticket. It
must sample rather than fetch a full page, it must say what the test itself
cost, and it must be a button the user presses rather than something that runs
on every keystroke.

For Reddit the number shown is a volume, not a price, because free-tier reads
cost nothing. The screen should not invent a cost that does not exist.

## Acceptance

- [x] A test action on the monitor form runs each generated query once against
      a small sample
- [x] The result shows estimated posts per day per query
- [x] For a metered source it also shows the estimated monthly cost at the
      source's own price
- [x] For a free source it shows volume only, and no invented price
- [x] The cost of the test itself is shown and recorded in `api_usage`
- [x] The test runs only when the user presses it
- [x] A query estimated to exceed the monitor's cap is flagged before the
      monitor can be started
- [x] A few sample matched posts are shown, so the user can judge quality and
      not only volume

## Notes

- Depends on [US-010](US-010-a-monitor-is-created-from-four-answers.md) and
  [US-013](US-013-a-monitor-cannot-spend-past-its-budget.md).
- STACK.md, *Query precision is a cost lever*.
- Showing sample posts is the part users will value most. Volume tells them
  what it costs; the samples tell them whether it is worth it.

## Log

- 2026-09-04T22:49+08:00 — Written from STACK.md.
- 2026-09-05T00:46+08:00 — Raised from p2 to p1, with US-013 and for the same reason: X
  bills every read and has no free allowance. A user cannot consent to a cost
  they are shown only after it is spent. Reddit through Bright Data adds a
  second reason — asking for comments doubles a monitor's cost, so the estimate
  must say so before the monitor runs.
- 2026-09-05T10:12+08:00 — Built. A cost test is a run and its probes, one probe per query
  per source, in `query_estimates` and `query_estimate_probes` (migration
  0008). It is a queued step and not an HTTP handler because a Reddit sample is
  billed when it is triggered and served about two minutes later: a request
  that held the connection open would lose a sample the person had already paid
  for. `POST /api/monitors/estimates` writes the run and answers 202; the
  worker's new `estimate` queue collects the samples; the screen reads `GET`
  until the run is finished. A `GET` writes nothing, so refreshing cannot spend
  money.

  `api_usage.monitor_id` is now nullable. The test runs before the monitor
  exists, which is the point of it, so its cost is on the bill and on no
  monitor's cap — the same shape `model_calls` already had for the queries the
  model writes from the same form. The unique constraint is `NULLS NOT
  DISTINCT`, so those rows still fold into one row per source per day instead
  of one per press of a button.

  `SourceDescriptor` gained two facts: `maxUnitsPerQueryPoll` and
  `minimumSearchWindowHours`. Both belong to the connector for the reason the
  price does. Hard-coding Reddit's fifty records and its one-day window in the
  estimate would report the wrong figure for every other source and go stale
  the day the connector's own default moved.

- 2026-09-05T10:12+08:00 — The arithmetic, and the one thing it is really saying. A poll
  costs a window, not a difference: the projection is `records a poll x polls a
  month`, and `records a poll` is a poll's window of posts up to what one query
  may collect. That reproduces what the 2026-09-05 live run measured — a
  monitor at the one-minute floor billing nine to eleven records a minute and
  storing nothing — and it is why the same plan costs $10.80 a month polled
  hourly and $648 polled every minute. A sample that came back full is read at
  the rate its posts arrived at rather than over the whole week, because the
  busiest queries are the ones a person most needs warning about. A source
  priced at zero gets a volume and no price, never $0.00.

  `estimate.test.ts` was written before `estimate.ts`, as docs/testing.md asks
  for a number a person reads before spending money. Its sixteen cases all
  passed on the first run, which that document treats as a warning rather than
  a result, so seven mutations were confirmed to turn it red: the minimum
  search window dropped, the connector's record cap dropped, the burst floor
  dropped, a free source given a price, the cap flag made exclusive, a stopped
  sample read as a finished one, and a month read as one poll. Two of the
  sixteen were wrong before that: the flag counted only past the cap, where
  US-013's guard counts at it, and a `Math.max` was unreachable.

- 2026-09-05T10:12+08:00 — Nine mutations of the step were each confirmed red, one at a
  time: the cursor dropped on a wait, the budget guard's answer ignored, a
  sample bought again before it was due, a stuck sample never abandoned, a page
  fetched and not billed, a full sample read as a measurement, a resume that
  brought nothing not counted, a finished run worked again, and a retest
  charged to nobody. 442 tests pass, with lint and typecheck.

- 2026-09-05T10:22+08:00 — Ran once against Bright Data, for $0.042, and it falsified
  the arithmetic above. Two keywords and one subreddit, ten records each. The
  trigger, the wait, the cursor, the snapshot read, the resume and the ledger
  all worked: three collections were triggered and kept their snapshot ids,
  fourteen resumes carried them, and the three trigger calls — billed nothing —
  folded into one `api_usage` row with no monitor against it, which is what
  `NULLS NOT DISTINCT` was added for.

  What did not work was the number on the screen.

      flaky end to end tests           billed 10 records, kept  0 posts -> $0.00/mo
      manual qa before every release   billed  8 records, kept  1 post  -> $1.08/mo
      QualityAssurance                 billed 10 records, kept 10 posts -> $7.56/mo
      TOTAL $8.64 a month, inside a $10.00 cap

  Every line understated, and the first one is the shape of the mistake: that
  query cost a cent and a half and would cost it on every poll for ever, and
  the screen called it free. Nothing on the page argued for deleting the most
  expensive thing on it.

  The cause was one decision. The projection counted the posts a sample kept;
  the provider bills the records it collected. Those differ whenever a query
  finds posts that are old, off-topic, or more numerous than the sample asked
  for — which is most of the time, and is the whole reason `unitsConsumed`
  exists in the connector interface rather than letting a caller count rows.

- 2026-09-05T10:22+08:00 — Rewritten to project from the units the source billed. One
  sample is one search; what it was charged, times the polls in a month, is the
  estimate. A sample billed everything it asked for had more to give, so it
  reports a range — one sample of ten cannot say where between ten and fifty
  records a poll the truth lies, and inventing a point estimate from it would
  be the number nothing measured that docs/costs.md exists to refuse. Volume
  still comes from the posts, because "is this worth having" and "what does it
  cost" are two questions.

  The same live rows, read through the new arithmetic:

      flaky end to end tests           $10.80 to $54.00/mo   flagged
      manual qa before every release   $8.64/mo
      QualityAssurance                 $10.80 to $54.00/mo   flagged
      TOTAL $30.24 to $116.64 against a $10.00 cap, over

  `minimumSearchWindowHours` went with the old arithmetic. It was added this
  session to model a poll's window and the new projection has no use for it, so
  a descriptor no connector reads is one field the next connector cannot get
  wrong. `maxUnitsPerQueryPoll` stays: it is the top of the range.

- 2026-09-05T10:22+08:00 — The run also found [BUG-002](BUG-002-a-seven-day-window-is-bought-as-a-month.md),
  which is why the first query kept no posts at all. The sample asked for seven
  days and the connector bought a month, because the two clock readings are
  taken a moment apart and the comparison was exact. Fixed there, with the
  cases that hid it.

- 2026-09-05T10:41+08:00 — Ran a second sample, for $0.015, once BUG-002 was fixed. The
  same keyword that had kept nothing kept all ten posts, inside the window, and
  now reads as $10.80 to $54.00 a month against a $10.00 cap — flagged, where
  before the fix it read as free.

  The sample posts earned their acceptance box on that run. The top one is a
  comparison of language models, which has nothing to do with flaky tests: the
  volume figure alone would have looked healthy, and only the excerpt shows the
  query is finding noise. Volume tells a person what it costs; the samples tell
  them whether it is worth it.

  Two runs, $0.057 in total.

- 2026-09-05T10:41+08:00 — What is still unproven. That a keyword sample of ten
  predicts a keyword poll of fifty — the range is an admission of exactly this,
  not a measurement of it, and closing it means testing a plan and then leaving
  the monitor to run for a month against the invoice. That Bright Data's free
  allowance behaves as documented, which none of this arithmetic models. And
  every failure path of the cost test: an expired snapshot, a collection the
  provider reports as failed, and a rate limit have still only been simulated.
  450 tests pass, with lint and typecheck.
