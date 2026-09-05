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

**Why the interface has to grow.** `SourceQuery` is `{ queries, channels,
since }`. There is no field to switch comments on, and no field to carry the
post URLs that comments are fetched by. `SearchResult.unitsConsumed` is one
number, so a second charge cannot be reported apart from the first. Three
things are missing, not one.

**Why comments cost a second call.** Bright Data discovers posts by keyword or
by subreddit. Comments are collected by post URL only — the same limit Reddit's
own API has, and a different dataset id. So a monitor that wants comments pays
once to find posts and again to read their comments, and its cost roughly
doubles. That is why this is opt-in and why the extra charge must be visible
before it is spent.

**Some comments already arrive free.** A captured post record carries an inline
`comments` array alongside `num_comments`. The inline array is a sample, not
the thread. Check what it actually contains before building the second call:
if a monitor's leads come from the sample often enough, the paid fetch may be
worth less than it costs.

The interface change is small and it is not a provider accommodation. X has
replies and Hacker News has comments, so "include the replies to a thing" is a
question every source can be asked. STACK.md's rule still holds: do not weaken
the interface to fit Bright Data.

## Acceptance

- [ ] `SourceQuery` carries an opt-in for comments, and a source that cannot
      fetch them ignores it rather than failing
- [ ] `SearchResult` reports what each kind of read cost, so a second charge is
      visible apart from the first, and the existing `unitsConsumed` still
      totals them
- [ ] The fake source can be told to bill two kinds of read, so callers can be
      tested against the split without a network and without a bill
- [ ] The Reddit connector fetches comments by post URL when the opt-in is set,
      and never when it is not
- [ ] A monitor stores the opt-in, in a migration that keeps it off for every
      existing monitor
- [ ] The monitor form shows the opt-in, says the cost roughly doubles, and
      leaves it off by default
- [ ] Tests run against comment payloads captured by
      `sources/reddit/fixtures/capture.mjs`, which already captures them
- [ ] The inline `comments` array on a post record is measured before the paid
      fetch is built, and what it contains is written in the Log

## Notes

- Depends on [US-005](../done/2026-09/US-005-reddit-returns-candidate-posts.md).
- The comment fixtures already exist:
  `packages/core/src/sources/reddit/fixtures/comments-by-post-url-records.json`,
  captured with `--only=comments`. The dataset id is in `brightdata.ts`.
- US-010 owns the monitor form. The opt-in is one more control there, so build
  it after US-010 unless the form is still unwritten.
- US-013 prices a monitor from `pricePerUnitMicros`. A second kind of read must
  reach the budget guard, or a monitor with comments spends twice its cap.
  docs/testing.md: a rule is only as tested as its least-tested caller.

## Log

- 2026-09-05T01:18+08:00 — Split from US-005. The interface change is the reason: three
  fields are missing and the decision belonged in its own ticket.
