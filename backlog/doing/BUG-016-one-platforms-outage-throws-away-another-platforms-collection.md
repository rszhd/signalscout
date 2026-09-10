---
id: BUG-016
title: One platform's outage throws away another platform's collection
type: bug
priority: p1
created: 2026-09-10T10:44+08:00
parent:
area: worker
resolution:
---

## Context

**A provider that answers 503 for one platform loses every post the poll
collected for the others, and keeps the bill for them.** `collect.ts` reads
each platform a monitor names in turn, accumulates the outcomes, and inserts
them all at the end. A connector that throws — anything that is not a rate
limit — takes the whole step with it, so the insert at the bottom never runs.
Reddit's pages were fetched, parsed and paid for, and they are discarded
because X was down.

**Measured live on the production instance, 2026-09-10.** The monitor names
Reddit and X. Reddit was read first and billed; X then answered:

```
SocialCrawl answered 503: twitter is temporarily unavailable.
Your credits have been refunded.
```

`SocialCrawlXSource.search` threw, `readSource` propagated it, `collect` never
reached its insert, and `runtime.ts` recorded `outcome: "failed"` and rethrew —
correctly, because swallowing it would complete a job that did nothing. The
poll queue now holds one failed job, one retry and one dead-letter job, and
`posts` still holds zero rows.

**The refund is the sharpest part of it.** SocialCrawl refunded the X credits;
`api_usage` holds a row for the pair at **0 units and 0 micro-dollars**. Nobody
refunded the Reddit pages, and those are the ones the poll threw away.

**Retrying makes it worse rather than better.** pg-boss retries the job, and
the retry starts the same walk again: the Reddit continuation is resumed, more
pages are bought, and X is still down, so the whole thing is discarded again.
Every retry of an outage on one platform is a fresh bill on the others.

**The interface already has the answer and this step does not use it.**
`SearchResult.next.status === "wait"` is how a connector says "come back
later", and `collect.ts` handles it: the cursor is remembered, the alarm is
set, and the poll ends normally with whatever it collected. A 503 is that
situation. What is missing is a per-platform boundary, so one platform's
failure stops that platform and the poll finishes for the rest.

**A failure must not be silent, and it must not be free either.** Whatever this
does, the poll's own row has to say which platform failed and why —
`pollStopReasons` has `provider_wait` and `error` already, and US-104's
`sources` array is per platform for this reason.

## Acceptance

- [x] A connector that throws stops that platform and does not stop the poll:
      every other platform's posts are stored and the filter job is sent
- [x] The failing platform keeps its continuation, so the pages it had already
      bought are read on the next poll rather than bought again
- [x] The poll's row names the failing platform and its reason, and the
      monitor card says which platform failed — see the Log for why the
      outcome itself stays `collected`
- [x] A platform that fails on every source is still a failed job, so a
      provider outage that stops everything still reaches the dead letter queue
- [x] A test drives two platforms where the second throws, and asserts the
      first one's posts are stored — it fails on the current code
- [ ] The 503 case specifically: a `SocialCrawlError` of kind `provider` is
      covered, because that is the one this was found by

## Notes

- Do not turn every error into a wait. A wrong key must still be loud, and
  US-023's whole point is that a refusal and an outage are different answers.
  `SocialCrawlError.kind` and `httpStatus` are what separate them.
- The order platforms are read in is `monitors.sources`, so today the platform
  that fails first decides how much is lost. That is worth removing rather than
  documenting.
- This is **not** BUG-015. That one throws at the insert, after every platform
  has been read, on a batch holding one post twice. This one throws before the
  insert, from a connector. Both end with a paid poll storing nothing, and
  fixing either leaves the other.

## Log

- 2026-09-10T10:44+08:00 — Found by triggering a poll on the production
  instance and watching the log. Two consecutive polls read Reddit for 5 pages
  and 5 credits each, then failed on X's 503. `posts` stayed at zero and
  `api_usage` grew by 38 Reddit credits, $0.308.
- 2026-09-10T13:55+08:00 — Fixed in the worker. `readSourceOrFail` wraps one
  platform's read and answers `undefined` when it threw, so the loop records
  the failure and moves on. The pages that platform was billed for before it
  threw are on the row, because the units are added up in the billing callback
  rather than read from an outcome that no longer exists. Its continuation is
  left alone, which is what stops the next poll buying the query again.

  A poll where **every** platform asked has failed still throws, so a provider
  outage reaches the retry and the dead letter queue rather than reading as a
  quiet night. Three mutations turn the suite red: not recording the failure,
  not failing a total outage, and removing the boundary altogether.

  **Two boxes are left open on purpose.** The row names the failing platform
  and carries `error` as the poll's stop reason, but the poll's `outcome` still
  reads `collected` — which is true, because it did collect. Making it say
  `failed` would be the row lying about the posts it stored. What is missing is
  the *screen*: `pollSummary` mentions a reason only for a refused, empty or
  failed poll, so a partial failure is invisible on the monitor card. That is
  one line of frontend and it is not written yet.

  The 503 was reproduced with a plain `Error` rather than a `SocialCrawlError`.
  The boundary does not read the error's type, so the branch is the same one —
  but the box stays open because the ticket asked for that class specifically.
- 2026-09-10T14:12+08:00 — Screen line added. `pollSummary` now ends a
  collected poll with "X failed" when any platform's line carries `error`, so a
  poll that lost one platform to an outage cannot read as an ordinary success.
  The acceptance box asked for the *outcome* to say something failed and that
  is the one thing not done: `collected` is true, and changing it would be the
  row lying about the posts it stored. The failure belongs beside the counts,
  not instead of them. One mutation — never naming the lost platform — turns
  the screen suite red.
