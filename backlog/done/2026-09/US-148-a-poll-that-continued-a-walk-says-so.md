---
id: US-148
title: A poll that continued a walk says so
type: feature
priority: p3
created: 2026-09-16T01:10+08:00
parent: US-104
area: web
resolution: shipped
---

## Context

**The owner read four rows a minute apart and asked why Reddit was polled
four times.** It was polled once. The first walk of a new monitor reads every
query and subreddit up to the page limit, and the page limit bounds one job,
not the walk: the cursor is saved and the next tick picks it up. Each pickup
is a poll run, and every run's sentence began "Last poll", so one walk in four
pieces read as four polls.

**The row already knew.** `walk_id` was added for exactly this reading — one
collection, several jobs — and the sentence did not use it. `continued` is
now read from it in every reader: an earlier run of the same walk exists. No
column, so rows written before this say the right thing too.

## Acceptance

- [x] `PollRun.continued` is true where an earlier run shares the walk, from
      `recordPollRun`, `readPollRuns` and `latestPollRuns` alike
- [x] The sentence opens "Continued from the last poll" on such a run, on the
      monitor page and the list

## Notes

Drizzle renders a column inside a select list bare, so the subquery's alias
captured it and every row compared with itself; the outer columns are written
with their table name. Not rendered in a browser.

## Log

- 2026-09-16T01:25+08:00 — Shipped.
