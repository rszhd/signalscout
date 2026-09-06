---
id: BUG-007
title: A comment is stored under a post it is not under
type: bug
priority: p1
created: 2026-09-06T15:40+08:00
parent: US-020
area:
resolution: shipped
---

## Context

The shared reply parser took a comment's parent from **our own request** and
never read the payload's own `post_id`. So whatever a comment endpoint returned
became a reply to the post we had asked about, whether it was one or not.

**Found live on 2026-09-06, on X.** `/twitter/tweet/replies` was asked for the
replies under one post and returned a later post by the same account on an
unrelated subject — hair care under a post about engineering teams. It carried
no `parent_id`, no leading @mention, and a `post_id` that was not the post
requested. The owner opened it and said it was not a reply.

**Storing it is worse than dropping it, and that is the reason this is a p1
rather than a tidiness fix.** A comment is judged with the post above it —
US-020 exists to store that link, and `ai/prompt.ts` puts the parent in the
prompt because "same here" means one thing under a question and another under
an answer. A wrong parent makes the model read real words against a
conversation they were never part of. Then the inbox shows "Replying to" above
a post the person never saw, and a human judging the match is misled the same
way the model was.

It also costs money in the ordinary way: a stray item buys a triage call, and
one that survives buys a classification.

**The fix is one comparison, and every platform supports it.** All four comment
endpoints send `post_id` on every comment — 137 of 137 across the X, YouTube
and TikTok fixtures — so a comment whose `post_id` disagrees with the post we
asked about is dropped. A comment that omits the field is kept: absence is not
disagreement, and no captured page has shown one.

**Why the provider did it is now measured, and it is a billing fact as much as
a correctness one.** Two posts were probed against the same endpoint:

| Thread | Items | `post_id` | `parent_id` | Credits |
|---|---|---|---|---|
| has replies | 28 | the post asked for | the post asked for | 1 |
| has none | 1 | **the item's own id** | absent | **1** |

So `/v1/twitter/tweet/replies` does not answer an empty thread with an empty
list. It returns **one unrelated recent post** — a different one on each call,
hair care and then a knowledge-business pitch — and bills a credit for it. The
signature is unmistakable once looked for: `post_id` equal to the item's own
id means the item is a top-level post whose parent is itself, which is not a
comment by any reading.

Two consequences beyond this fix. **An empty X thread is not free**, which
contradicts the refund this repository has measured twice on X *search* and
recorded in AGENTS.md — that refund is a property of the search endpoint and
does not travel to this one. And the answer carried `next.status: "ready"`
with `partial: true`, so a caller that trusts the cursor pages on through
nothing; `maxPagesPerThread` bounds that at four credits per empty thread.

This is the fourth completeness or correctness claim from a provider to be
wrong here, after X search's `has_more: true` leading to an empty page,
ScrapeCreators' Reddit `has_more: false` with 33 comments missing, and
YouTube's two flags lying in opposite directions.

The same run proved the fix does not overreach: all 28 genuine replies under
the busy post pass the check, each with the reply author's own handle in the
URL the provider supplies.

**One test in `x.test.ts` had to be corrected as part of this**, and the reason
is worth keeping. It refused a comment with a missing field while passing
`parentPostExternalId: "p"` against a real fixture comment. After this change
it still passed — but for the new reason rather than the one it names, which
is the same "green for the wrong reason" trap this session already hit once.

## Acceptance

- [x] A comment whose `post_id` disagrees with the requested post is dropped by
      the shared parser, on every platform that uses it
- [x] A comment that carries no `post_id` is kept
- [x] Removing the check turns a test red
- [x] The live X probe that returned the stray item now returns nothing for the
      same post
- [x] The test that would have passed for the wrong reason is corrected to use
      the real parent
- [x] Stored rows are audited, and the answer is that they cannot be by query:
      `post_id` was never stored, only the parent we assigned, so a row that
      disagreed left no trace. The owner decided on 2026-09-06 to accept the
      rows rather than re-fetch. The reasoning is sound and worth keeping: the
      stray item appears on a thread with **no** replies, so it arrives alone
      and displaces nothing. At most one wrong row per empty thread, and the X
      reply path has never run through the worker at all
- [x] One more probe says why `/twitter/tweet/replies` answered a post with a
      non-reply — whether an empty thread falls back to something else, and
      whether it bills for it

## Notes

- The X reply path has still never run through the worker, so nothing wrong has
  been stored from it. What made this visible was US-047's link check, not a
  bad match in the inbox.
- The check belongs in the shared parser rather than in each connector, because
  the failure is a property of the envelope and not of one platform. Every
  connector that adopts `toCandidateReply` inherits it.
- **Consider storing `post_id` as the provider gave it.** Nothing needs it
  today, and it is the column that would have made the audit above a query
  rather than a re-fetch. Weigh that against a column nothing reads: the
  argument for it is that this bug was invisible in the data it corrupted.
- `x-reply-link-probe.ts` is the instrument that found it. US-047 says to
  delete it when that ticket closes; delete it after this one is satisfied
  instead.

## Log

- 2026-09-06T15:40+08:00 — Found while checking US-047's last box, which was
  only ever meant to confirm that an X reply link opens. The link was fine as a
  URL; what was wrong was that the thing it pointed at was not a reply. Fixed
  in the parser, with the live probe re-run as evidence: same post, same
  request, and the stray item is now dropped.

- 2026-09-06T15:52+08:00 — The provider's half is answered. An X thread with no
  replies returns one unrelated top-level post, different every call, billed at
  one credit, with a cursor that invites paging. A thread with 28 replies
  returns 28 correct ones. So the endpoint has no empty answer, and the
  `post_id` check is what separates the two — it is not a guard against a rare
  glitch but against this endpoint's normal behaviour on a quiet thread.

  It also produced what US-047's last box needs: 28 real reply URLs, each
  carrying its own author's handle, supplied by the provider rather than built
  by us. Pressing one is still that ticket's box and not this one's.

- 2026-09-06T16:05+08:00 — Closed. The owner decided not to re-fetch the stored
  replies, on the grounds that at most one stray row can exist per empty thread
  — the endpoint returns a single unrelated post when a thread has none, so
  there is no case where many wrong rows arrive together. The X path, where
  this was found, has never run through the worker.

  `post_id` is still not stored. If a second provider bug ever needs auditing,
  that is the column to add first; the Notes say why.
