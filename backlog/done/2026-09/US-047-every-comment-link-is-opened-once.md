---
id: US-047
title: Every comment link is opened once
type: chore
priority: p2
created: 2026-09-06T15:32+08:00
parent: US-020
area:
resolution: shipped
---

## Context

**This ticket exists because a link nobody clicks is not a link.** On
2026-09-06 the TikTok connector shipped `?comment_id=`, a parameter it invented
on the argument that it could only help. It survived a fixture capture, two
live polls and a code comment that openly said it was unverified. The owner
pressed it and got the video with the comment section closed. The real format
turned out to be `?cid=`, which TikTok puts in its own comment notification,
and it was confirmed by building one from a comment the pipeline had collected
and opening it.

All four are now confirmed by a person pressing the button, including the one
built exactly the way the broken one was.

| Platform | Where the link comes from | Opened? |
|---|---|---|
| Reddit | the provider returns it | yes, 2026-09-06 |
| TikTok | we build `?cid=`, TikTok's own format | yes, 2026-09-06 |
| YouTube | we build `&lc=`, YouTube's own format | yes, 2026-09-06 |
| X | the provider returns it, a `status` URL | yes, 2026-09-06 |

**YouTube is confirmed and it was the one at risk**, because it is the same
shape as the mistake: a parameter this repository appends to a watch URL. It
works, and it gives the clearest evidence of the four — YouTube renders the
comment highlighted, so the link is not merely accepted, it is understood.

That leaves one, and it needs a live fetch rather than a click on something
already stored. **No X reply has ever been stored.** US-006's poll collected
posts, and `fetchReplies` for X was added later by US-020 and has not run
against a real thread.

**X is the one least likely to be wrong and still worth one press.** The
provider returns a URL for every reply and it is an ordinary `status` link,
which is X's permalink for any post. Nothing is invented. A press costs
nothing and turns "should be fine" into "checked".

**There is nothing to build unless a link is broken.** This is a verification
ticket. If both open the comment, the outcome is four ticked rows and a
sentence in AGENTS.md; if one does not, the fix follows the TikTok pattern —
find the platform's own format, build from a comment this product collected,
open it, and only then write it down.

**The screen is already honest about the failure case.** `platformLabels` in
`Inbox.tsx` carries `commentLink: "comment" | "thread"` per platform. A
platform whose link cannot reach the comment says so above the button, names
the author to look for, and the button reads "Open the post". So a broken link
found here is a one-line change plus the truth on the screen, not a redesign.

## Acceptance

- [x] A YouTube comment link is opened by a person and the Log says whether it
      landed on the comment. Use a stored one rather than a hand-made URL, so
      what is tested is what the pipeline produces
- [x] An X reply link is opened by a person, same rule. This one needed a live
      `fetchReplies` first, because no X reply had ever been stored
- [x] Any link that does not reach its comment is either replaced with the
      platform's own format — read off the platform, not remembered — or the
      platform is marked `commentLink: "thread"` so the screen stops promising
      it
- [x] A replacement format is pinned in the connector's tests against a string
      the platform itself produced, written out as a literal. `tiktok.test.ts`
      is the pattern: a test that encodes and decodes with the same function
      proves our arithmetic and nothing about the platform
- [x] Stored rows are backfilled if a format changes, and the backfilled URL is
      compared against the one that was opened
- [x] AGENTS.md records, per platform, where the comment link comes from and
      whether anyone has opened one
- [x] The Log says whether each link was opened signed in or signed out.
      TikTok's `?cid=` is confirmed signed in only, and a link that needs a
      session is a different promise from one that does not

## Notes

- LinkedIn is absent from the table because its replies are not built. US-020
  holds that box.
- One link per platform is enough. This is not a sample of behaviour, it is a
  check that a format is real.
- YouTube had 7 stored comments and one of them settled it. X has none: the
  reply path there is built and tested against captured fixtures, but it has
  never run live, so this box carries a second claim with it — the first live
  proof of X replies.
- Do not let this grow into a link checker that runs on a schedule. A format is
  stable or it is not, and a job that opens strangers' comment pages on a timer
  is a different thing with a different cost.

## Log

- 2026-09-06T15:32+08:00 — Written after the TikTok comment link was found
  broken and then fixed on the same day. The owner asked for the other
  platforms to be checked later, and named Reddit and TikTok as the two that
  work so far.

- 2026-09-06T15:38+08:00 — YouTube confirmed. A stored comment link opened and
  YouTube rendered the comment **highlighted**, which is stronger than the
  other two: the platform is not merely tolerating the parameter, it is acting
  on it. `&lc=` is ours to build and it is correct.

  Three of four are now confirmed by a person pressing the button. X is left,
  and it is the only one that cannot be checked from stored data.

- 2026-09-06T15:40+08:00 — The X box is not closed and the reason is a
  different bug. A live `fetchReplies` returned one item, and it was not a
  reply: a later post by the same account on an unrelated subject, with a
  `post_id` that was not the post requested. The owner opened it and said so.

  That is [BUG-007](BUG-007-a-comment-is-stored-under-a-post-it-is-not-under.md),
  and it is worth more than this ticket was: the parser took a comment's parent
  from our own request and never read the payload's own, so anything an
  endpoint returned became a reply to the post we asked about.

  The link check itself is still open. No X reply link has been pressed,
  because the one item this probe found was not an X reply.

- 2026-09-06T15:52+08:00 — A real X reply link exists to press at last, and
  getting one took [BUG-007](BUG-007-a-comment-is-stored-under-a-post-it-is-not-under.md)
  being understood first. The earlier probe had asked a post with no replies,
  and that endpoint answers such a post with an unrelated top-level post rather
  than with nothing. A post with 28 replies returns 28 real ones:

      https://x.com/m13v_/status/2066217164928077884

  The URL is the provider's, not ours, and it carries the reply author's own
  handle rather than the parent author's — which was the other thing the first
  probe left ambiguous.

- 2026-09-06T15:55+08:00 — **All four confirmed.** The X link was opened and it
  reaches the reply. Every platform this product reads comments from now has a
  comment link a person has pressed:

  | Platform | Built by | Confirmed |
  |---|---|---|
  | Reddit | the provider | yes |
  | X | the provider | yes |
  | YouTube | us, `&lc=` | yes, renders the comment highlighted |
  | TikTok | us, `?cid=` | yes |

  All four were opened in a signed-in browser. Nobody has tried one signed out,
  and that is the one thing this ticket leaves unproven rather than unanswered.

  The ticket cost more than it was meant to and returned more. It was written
  to press two buttons. It found that the TikTok link was broken and what the
  real format was, that YouTube's is not merely tolerated but understood, and —
  through the X probe — [BUG-007](BUG-007-a-comment-is-stored-under-a-post-it-is-not-under.md),
  which is the larger finding of the two: comments were being attributed to
  posts they were not under.

  `x-reply-link-probe.ts` stays until BUG-007's last box closes, then goes.
