---
id: BUG-436
title: A source that fails part way through a poll loses the pages it already billed
type: bug
priority: p2
created: 2026-09-29T21:07+08:00
parent:
area: pipeline
resolution:
---

## Context

`readSource` in `worker/collect.ts` keeps each page's posts in a local list
and returns them when the walk ends. When the connector throws on a later
page, `readSourceOrFail` catches the error and returns `undefined`, and the
collect step moves on with `if (!outcome) continue;`. The pages that came
back before the error are gone:

- **They are paid for.** Each page is billed to `api_usage` as it arrives
  (BUG-016 made sure of that), so the ledger and the poll run show the spend.
- **Their posts are not stored.** No row in `posts`, no `post_discoveries`,
  nothing sent to the filter.
- **The next poll buys them again.** A failed source writes neither its
  coverage nor a continuation, so the next poll starts that input where the
  last good one ended, and the provider bills the same pages a second time.

Seen live on 2026-09-29 in a private experiment on these packages (US-434):
ScrapeCreators answered 500 on the eighth Reddit request of a first poll.
Seven requests were billed ($0.013) and the poll stored no Reddit post. The
poll did not fail as a job, because X in the same poll worked, so nothing
retried it either.

A provider's 500 in the middle of a walk is ordinary. The fix keeps what was
already fetched: the posts from the pages before the error are stored and
filtered like any others, and the source's poll-run entry still says
`error`. Whether the walk's position is written, so the next poll resumes
after the last good page rather than starting again, is part of this ticket
and needs a decision: a continuation keeps the pages paid for, but a cursor
the provider has just refused may not be one it takes back.

## Acceptance

- [x] A connector that throws on its third page leaves the posts of the first
      two in `posts` and `post_discoveries`, and they reach the filter queue.
- [x] The poll run still records that source as `error`, with the units
      and cost of the pages it read.
- [x] The next poll does not buy the pages that were stored, or the ticket
      says why it must.
- [x] A source that throws on its first page behaves as today.
- [x] The suite passes.

## Notes

- `readSource`, `readSourceOrFail` and the `if (!outcome) continue;` in
  `packages/pipeline/src/worker/collect.ts`. The continuation rule is in the
  comment above the failure callback.
- Cursor and deduplication are a correctness-critical surface: the test is
  written first.

## Log

- 2026-09-29T21:07+08:00 — Written from US-434's fourth live scan.
- 2026-09-29T23:31+08:00 — Fixed. `readSource` returns the pages it has, the error and the
  failed page's cursor when a connector throws after at least one page; on
  the first page it throws as before. The collect step stores and filters
  those posts, notes the source as `error` with its pages and cost, and
  remembers a continuation at the failed cursor, due after
  `failedPageRetryMs` (ten minutes) rather than at once, so an outage is not
  a loop of paid retries; the existing attempt limit drops a cursor that
  keeps failing. The decision the Context left open: resume, not restart.
  Such a source is not counted among the failed platforms, because the
  all-failed throw comes before the insert and would lose the posts again; a
  provider still down fails the resumed walk on its first page, which does
  count. One existing test expected the job to throw after two billed pages;
  it now expects the job to finish and keep them, and its point — both pages
  on the ledger — is unchanged.

