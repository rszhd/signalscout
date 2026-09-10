---
id: BUG-015
title: One post found twice in a poll throws away the whole collection
type: bug
priority: p1
created: 2026-09-10T10:31+08:00
parent:
area: worker
resolution:
---

## Context

**A poll that finds the same post through two of its own queries stores
nothing at all, and keeps the bill.** `collect.ts` builds one `INSERT` from
every post every source returned and hands it `on conflict (source,
external_id) do update`. Postgres refuses a statement whose own rows collide:

```
ON CONFLICT DO UPDATE command cannot affect row a second time
```

It is not a partial failure. The whole statement is rejected, so a poll that
collected 125 posts stores **none** of them, sends no `filter` job, and has
already paid the provider for every page.

**The scoped Reddit phase makes this routine rather than rare.** US-031's
SocialCrawl connector searches a keyword *inside* a subreddit, and a monitor
with five queries and eight subreddits asks forty (query, subreddit) pairs. A
post in r/SaaS that matches two of those five queries comes back twice in one
poll, into one batch. The same shape exists wherever two queries overlap on any
platform; Reddit's cross product only makes it near certain.

**Measured on 2026-09-10.** A poll driven against the real provider with the
production monitor's own plan collected **125 posts in 5 pages for 5 credits**
and then threw on the insert. Reduced to its smallest form — two rows with one
`external_id` in one statement — the same error comes back, so the cause is the
statement and not the data.

**`on conflict` is not the guard people assume it is.** It resolves a collision
with a row that is *already in the table*. It says nothing about two rows
arriving together, and there is no `do update` variant that does. The repair is
to deduplicate the batch before it is sent: last write wins per `(source,
external_id)`, which is what the existing `do update` already means for a row
already stored.

**The `posts_returned` count US-104 records must keep counting what the
connectors returned**, not what survives deduplication. A poll that found one
post through three queries found one post and paid for three searches, and both
halves of that sentence are worth reading.

## Acceptance

- [ ] A poll whose sources return the same post more than once stores it once
      and stores every other post beside it
- [ ] The `filter` job carries that post's id once
- [ ] `poll_runs.posts_returned` still counts what the connectors handed back,
      so the duplication is visible rather than hidden by the fix
- [ ] A test drives the poll step with a connector that returns one post twice
      in one poll, and fails on the current code
- [ ] The same test covers two sources returning one post, which is the
      cross-platform shape of it

## Notes

- Found while answering a different question: why the first monitor on the
  production instance collected nothing. This is **not** proven to be that
  fault — production's jobs all completed, and this one throws — so read the
  two apart. What the probe did prove is that the connector, the queries and
  the parser are all fine.
- Deduplicate on `(source, external_id)` and nothing else. That pair is the
  unique index, and `provider` is deliberately outside it: the same post
  through two providers is one post, which is US-024's rule and already tested.
- Do not reach for `do nothing`. It returns no row for a conflict, and the ids
  it would drop are the ones a second monitor's pipeline needs — the comment
  above the statement says why.

## Log

- 2026-09-10T10:31+08:00 — Written from a live probe against SocialCrawl:
  125 posts collected, 5 credits spent, nothing stored, and the reduced case
  reproduces the error with two rows and no network.
