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

Reddit is the first source, and for the first release it is the only one that
costs nothing to run. It carries the MVP.

Its free tier allows 100 queries per minute with OAuth, and one search call
returns up to 100 posts. Volume is not the constraint. Two other things are.

**The terms are the constraint.** The free tier is for approved personal,
non-commercial use. Commercial use needs a reviewed contract starting around
$12,000 per month. A user monitoring for leads is doing commercial monitoring.
Bring-your-own-keys is the answer: the user registers their own Reddit app,
under their own account, and accepts Reddit's terms directly. We ship the
connector. The README must say this plainly, because a user who does not know
what they agreed to cannot consent to it.

**Deleted content must stop being shown.** That is handled in
[US-015](US-015-a-deleted-post-stops-being-shown.md), but this connector
decides what gets stored, so it stores an excerpt and an id rather than a
permanent full copy.

Posts and comments both carry intent. A comment answering "what do you all
use?" is often a better signal than the post above it. Both are fetched.

## Acceptance

- [ ] A Reddit connector implements `SocialSource`
- [ ] OAuth uses the user's own client id and secret; a missing or invalid
      credential fails validation with a message that names what to fix
- [ ] `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` are read on every
      response, and the connector backs off before the limit is reached
- [ ] Back-off is inside the connector; the caller does not know Reddit has
      headers
- [ ] A search accepts subreddits and a query, and returns posts and comments
- [ ] A cursor is stored per query and sent on the next poll, so no page is
      fetched twice
- [ ] Only an id, an excerpt, an author handle, a permalink and a timestamp
      are stored — not a full permanent copy
- [ ] Tests run against recorded fixtures, not the live API
- [ ] The README states what a user agrees to when they register a Reddit app

## Notes

- Depends on [US-003](US-003-a-source-implements-one-interface.md).
- STACK.md, *Source economics*, for the tier table and the terms question.
- The hosted version's position under Reddit's terms is a legal question, not
  an engineering one. It is not settled by this ticket and must be settled
  before the hosted launch.
- `snoowrap` is unmaintained. Use `fetch` against the OAuth API.

## Log

- 2026-09-04 — Written from PLAN.md and STACK.md.
