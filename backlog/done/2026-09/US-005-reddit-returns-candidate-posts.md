---
id: US-005
title: Reddit returns candidate posts
type: feature
priority: p1
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

Reddit is the first source. It carries the MVP because it is the cheaper of the
two and it starts free.

**It is no longer reached through Reddit's own API.** Reddit's Responsible
Builder Policy, from November 2025, replaced self-serve app registration with a
manual approval request. Developers report rejections for small projects and
long silences. Keys issued before the policy still work, but an open-source
product cannot ask every self-hoster to win an approval before the software
runs. That is not a bring-your-own-keys product; it is a waiting list.

So Reddit is reached through **Bright Data**, and the user brings a Bright Data
key. STACK.md, *A source is not a provider*, holds the reasoning and the rule it
produced: the architecture supports replaceable providers, the product offers
one provider per source. The user connects *Reddit*. The UI names Bright Data in
secondary text, because a user routed through a third party must be told so, and
never asks them to choose.

Three facts about this provider shape the connector.

**It bills per record, not per call.** $1.50 per 1,000 records, after 5,000 free
records each month. So `unitsConsumed` is the record count and
`pricePerUnitMicros` is 1500. This is why the interface reports cost rather than
letting the caller count posts.

**Comments cannot be discovered by keyword.** Posts are discovered by keyword or
by subreddit. Comments are collected *by post URL only* — the same limit Reddit's
own API has. A monitor that wants comments therefore pays a second call per
post, and its cost roughly doubles. Comments must be opt-in per monitor, not a
default, and the extra cost must be visible before it is spent.

**Collection is asynchronous.** A small request answers within about a minute.
A larger one returns a `snapshot_id` to poll. That is
`next: { status: "wait", retryAfter, cursor: snapshotId }`. The connector does
not block a worker for minutes, and the caller never learns what a snapshot is.

Deleted content must stop being shown. US-015 does the reconciliation; this
connector decides what is stored, so it stores an excerpt and an id rather than
a permanent full copy.

## Acceptance

- [x] A Reddit connector implements `SocialSource` and is registered in
      `builtInSources`; nothing outside its folder names Bright Data
- [x] The user's own Bright Data key authenticates; a missing or invalid key
      fails validation with a message that names what to fix
- [x] A search accepts subreddits and a query, and discovers posts by both
- [ ] Comments are opt-in per search, and the request that fetches them is
      counted and reported separately, because it is a second charge
      — moved to [US-020](../../todo/US-020-a-monitor-can-include-comments-and-replies.md)
- [x] `unitsConsumed` is the number of records the provider billed, and it is
      never derived from `posts.length` by the caller
- [x] A request too large to answer synchronously returns
      `next.status === "wait"` carrying the snapshot id as the cursor, and a
      later call with that cursor returns the finished page
- [x] A cursor is stored per query and sent on the next poll, so no page is
      fetched twice
- [x] Only an id, an excerpt, an author handle, a permalink and a timestamp
      are stored — not a full permanent copy
- [x] Tests run against fixtures captured from real Bright Data responses by a
      committed, re-runnable script; no test reaches the live API
- [x] Captured payloads are stored whole, with identifying fields scrubbed, and
      no fixture is written from memory
- [x] The README says Reddit data arrives through Bright Data, and what a user
      needs in order to connect it

## Notes

- Depends on [US-003](../done/2026-09/US-003-a-source-implements-one-interface.md).
- STACK.md, *Source economics*, for the numbers and *A source is not a
  provider* for the rule.
- Bright Data's free tier needs no card, so the fixtures can be captured
  without a purchase. Capture them before writing the parser.
- The interface does not change for this. `unitsConsumed`, `next` and
  per-call credentials already cover a provider that bills per record and
  answers asynchronously. A provider that seems not to fit is a provider we
  have described wrongly.
- [docs/testing.md](../../docs/testing.md), *A fixture for someone else's API
  must be captured, not written*.
- The capture script is `packages/core/src/sources/reddit/fixtures/capture.mjs`.
  `--only=credentials` re-captures the free payloads and spends nothing; a full
  run costs about 25 records against a free tier of 5,000 a month.
- **Bright Data sent no rate-limit headers in any captured response**, so the
  connector has no back-off of its own. It is not a gap that can be closed by
  guessing: the header would have to be observed first. If a poll is ever
  refused for rate, capture that answer and handle it here, never in the
  caller. docs/sources.md, *The rate limit is yours, not the caller's*.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md and STACK.md.
- 2026-09-04T22:54+08:00 — Fixture requirement tightened from "recorded" to "captured
  by a committed script", after adopting docs/testing.md.
- 2026-09-05T00:46+08:00 — Started against Reddit's own OAuth API. Wrote the capture script
  first, so the parser would be written against real payloads.
- 2026-09-05T00:46+08:00 — Blocked, then rewritten. Reddit refused to register a new app
  and pointed at the Responsible Builder Policy. The blocker is external and
  has no engineering answer: an approval we might not get, for a product whose
  users would each need their own. The Reddit OAuth capture script was deleted
  rather than kept, because a committed instrument for an API we do not call
  reads as a plan rather than as a dead end.
- 2026-09-05T00:46+08:00 — Provider decision taken: Bright Data for Reddit, official API for
  X. Both load-bearing claims were checked before the rewrite. Bright Data does
  support discovery by keyword and by subreddit, and its free tier is 5,000
  records a month with no card. X's self-serve path is pay-per-use only since
  February 2026, with no free tier. Reddit therefore stays the free path and
  costs about a third of an X read.
- 2026-09-05T00:46+08:00 — Two consequences the provider decision carries, recorded here so
  they are not rediscovered: comments cost a second call per post, and a large
  request is asynchronous. Neither needs a change to `SocialSource`.
- 2026-09-05T01:18+08:00 — Fixtures captured from a live account. The first run proved why
  the rule exists: Bright Data's own documentation was wrong three times over.
  `date` is a named range ("Past month"), not the calendar date the docs show,
  and a calendar date is refused. Progress reports `running`, not the
  documented `collecting` and `digesting`. Snapshot ids are `sd_`, not `s_`.
  A parser written from the documentation would have been wrong in all three
  places and green in every test.
- 2026-09-05T01:18+08:00 — Credentials are checked by triggering an empty input list. An
  empty list cannot start a collection, so the check is free however valid the
  key is. A bad key answers 401 before the input is read; a good one gets as
  far as "No data to trigger". Both answers are captured, so the branch is not
  a guess about which failure means which.
- 2026-09-05T01:18+08:00 — Comments split out to US-020. They cannot be added without
  changing the `SocialSource` interface US-003 settled: `SourceQuery` has no
  opt-in and no place for post URLs, and `unitsConsumed` is one number, so a
  second charge cannot be reported apart from the first. That is three missing
  fields, and the decision deserved its own ticket rather than being taken in
  passing. The comment fixtures are already captured and committed, so US-020
  starts with its evidence in hand.
- 2026-09-05T01:18+08:00 — A gap found while checking the acceptance list rather than by a
  test: with both queries and subreddits set, the first version collected the
  keywords for ever and never asked for the subreddits. The cursor now names
  the phase, and the connector hands over to the subreddits when the keywords
  are exhausted. A caller that reads `next` cannot tell, which is the point.
- 2026-09-05T01:18+08:00 — Every load-bearing line was broken on purpose and the suite went
  red for all ten: double billing, billing the page length, dropping the
  `since` filter, ignoring the cursor offset, reading a not-yet-servable
  snapshot as records, rounding the date window inwards, failing to recognise a
  rejected key, never handing over to the subreddit phase, accepting a cursor
  we never issued, and starting a phase without reporting it. Two of the ten
  survived at first; the tests were widened until they did not.
- 2026-09-05T01:18+08:00 — **Unproven until it runs somewhere real.** `capture.mjs` drove
  the live trigger, progress and download endpoints, so the payload shapes are
  evidence. The connector's own code has only ever replayed them. Its handling
  of a failed collection, of a snapshot that expires, and of any rate limit has
  never met the provider. Budget that into the first ticket that schedules it.
