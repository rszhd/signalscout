---
id: US-005
title: Reddit returns candidate posts
type: feature
priority: p1
created: 2026-09-04
parent:
area:
resolution:
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

- [ ] A Reddit connector implements `SocialSource` and is registered in
      `builtInSources`; nothing outside its folder names Bright Data
- [ ] The user's own Bright Data key authenticates; a missing or invalid key
      fails validation with a message that names what to fix
- [ ] A search accepts subreddits and a query, and discovers posts by both
- [ ] Comments are opt-in per search, and the request that fetches them is
      counted and reported separately, because it is a second charge
- [ ] `unitsConsumed` is the number of records the provider billed, and it is
      never derived from `posts.length` by the caller
- [ ] A request too large to answer synchronously returns
      `next.status === "wait"` carrying the snapshot id as the cursor, and a
      later call with that cursor returns the finished page
- [ ] A cursor is stored per query and sent on the next poll, so no page is
      fetched twice
- [ ] Only an id, an excerpt, an author handle, a permalink and a timestamp
      are stored — not a full permanent copy
- [ ] Tests run against fixtures captured from real Bright Data responses by a
      committed, re-runnable script; no test reaches the live API
- [ ] Captured payloads are stored whole, with identifying fields scrubbed, and
      no fixture is written from memory
- [ ] The README says Reddit data arrives through Bright Data, and what a user
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

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
- 2026-09-04 — Fixture requirement tightened from "recorded" to "captured
  by a committed script", after adopting docs/testing.md.
- 2026-09-05 — Started against Reddit's own OAuth API. Wrote the capture script
  first, so the parser would be written against real payloads.
- 2026-09-05 — Blocked, then rewritten. Reddit refused to register a new app
  and pointed at the Responsible Builder Policy. The blocker is external and
  has no engineering answer: an approval we might not get, for a product whose
  users would each need their own. The Reddit OAuth capture script was deleted
  rather than kept, because a committed instrument for an API we do not call
  reads as a plan rather than as a dead end.
- 2026-09-05 — Provider decision taken: Bright Data for Reddit, official API for
  X. Both load-bearing claims were checked before the rewrite. Bright Data does
  support discovery by keyword and by subreddit, and its free tier is 5,000
  records a month with no card. X's self-serve path is pay-per-use only since
  February 2026, with no free tier. Reddit therefore stays the free path and
  costs about a third of an X read.
- 2026-09-05 — Two consequences the provider decision carries, recorded here so
  they are not rediscovered: comments cost a second call per post, and a large
  request is asynchronous. Neither needs a change to `SocialSource`.
