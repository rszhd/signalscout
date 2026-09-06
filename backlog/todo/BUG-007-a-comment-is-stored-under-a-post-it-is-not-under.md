---
id: BUG-007
title: A comment is stored under a post it is not under
type: bug
priority: p1
created: 2026-09-06T15:40+08:00
parent: US-020
area:
resolution:
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

**What this does not explain is why the provider returned it.** The request was
correct — `/v1/twitter/tweet/replies?url=<the post>` — and the answer was not.
The post may genuinely have no replies, with the endpoint falling back to
something else rather than returning an empty list. That is the third
completeness or correctness claim from this provider to be wrong, after X's
`has_more: true` leading to an empty page and ScrapeCreators' Reddit
`has_more: false` with 33 comments missing. Our half is now defensive; the
provider's half is unexplained and is worth one more probe before X replies are
trusted at volume.

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
- [ ] Stored rows are audited. **This cannot be done by query**, and that is
      the finding: `post_id` was never stored, only the parent we assigned, so
      a row that disagreed with the provider left no trace of the
      disagreement. Every reply does hang off a real post — 1,013 replies,
      none orphaned — but that proves the foreign key, not the parentage.
      Closing this means re-fetching a sample of threads and comparing, which
      costs credits, or accepting the rows as they are
- [ ] One more probe says why `/twitter/tweet/replies` answered a post with a
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
