---
id: US-135
title: ScrapeCreators reads the comments under a YouTube video
type: feature
priority: p1
created: 2026-09-15T13:58+08:00
parent: US-020
area:
resolution:
---

## Context

**This is the connector the lent-keys plan fetches YouTube through, and it
returns no comments.** US-134 names ScrapeCreators for Reddit, YouTube and
TikTok, and its Reddit and TikTok connectors read threads. The YouTube one
declares `canFetchReplies: false`, so a person on that plan who ticks "include
replies" on YouTube is told, correctly, that they will get none.

**It was left out on evidence, not for lack of an endpoint.** US-121 measured
the comment endpoint on 2026-09-11: one comment across twenty videos on the
test keyword, and it was "nice video sir". A comment carries an id, an author,
a `replyLevel` and no permalink and no parent id. Its `publishedTime` is an
absolute date, but it is derived from "3 weeks ago" — the captured fixture
shows it exactly twenty-one days before the capture, to the millisecond — and
there is no `includeExtras` to correct it. The description and the transcript
are where the text is on this platform.

**The evidence is about one keyword, and the plan is about every keyword.** A
monitor for a product with a YouTube audience — a tool reviewed in tutorials,
say — draws the questions in the comments, not in the description. The
connector should offer the thread and price it honestly, and the monitor form
already says per platform what a thread costs in model calls.

**The timestamp is the decision here.** A reply's `postedAt` is what the date
cut in `fetchReplies` compares against `ReplyRequest.since`, and a date that is
three weeks old to the millisecond is a date the provider made up from a
relative string. Storing it as if it were exact would let a comment written
"3 weeks ago" — anywhere in a fourteen-day window — pass or fail the cut on a
figure nobody stands behind. So the connector stores the provider's date and
marks it approximate, and the date cut on this connector is applied at the
day and never at the second.

## Acceptance

- [x] The connector declares `canFetchReplies: true`, and no separate reply
      price: the ledger shows a comment page charged 1, the same as a search
- [x] `fetchReplies` reads one page of comments by video URL, `order=newest`,
      and pages on `continuationToken`. Page two repeated none of page one
- [x] A reply's id is the comment id the provider gives and its parent post is
      the video the caller asked about. A nested reply is never on the page:
      each parent carries a `repliesContinuationToken`, a credit per subtree,
      and the connector buys none and reports the page partial instead
- [ ] The permalink is `watch?v=<video>&lc=<comment id>`, built by the
      connector. **Not yet pressed** — the browser extension was not connected
      on 2026-09-15. Open one:
      https://www.youtube.com/watch?v=BQqzfHQkREo&lc=UgxjcgU2He7VnTdNHV14AaABAg
- [x] The comment's date is stored marked approximate, and the `since` cut is
      made at the precision of the relative text: "4 years ago" is dropped
      against a thirty-day window, "3 weeks ago" is kept six days past its
      computed date and dropped eight days past. A test proves both
- [x] The parser replays `comments-deep-page-1`, `-page-2`, `-top` and the
      one-comment `comments-newest`. Captured 2026-09-15, four credits
- [x] `order` was tested on real output, not on the status code: `newest` and
      `top` both bill 1 and return 20, share 19 ids, and neither is date order
- [x] The monitor form reads the declaration through `canFetchRepliesFor`; the
      connector comment says what is measured now, and US-121's finding stays
      in its Log
- [x] No test spends money. 2,147 pass, typecheck and lint pass

## Notes

- `scrapecreators/tiktok.ts`, `fetchReplies`, is the shape: one page, date
  cut per row, `partial` from unread replies or a continuation.
- `youtube-fixtures/capture.mjs` already picks its comment target by
  `commentCountInt`. Add a `--comments-deep` mode that picks the busiest video
  from the search and reads two pages, so paging and `replyLevel` are both
  captured.
- US-121's Log holds the finding that argues against this ticket. Do not
  remove it. It is what the ticket answers.

## Log

- 2026-09-15T13:58+08:00 — Written. The owner asked for comments on every
  connector; this is the first of five, and the only one whose key is on the
  development machine.

- 2026-09-15T14:10+08:00 — **Built, four credits spent, one box open.**
  `--only=comments-deep` found 419 comments under one "playwright vs cypress"
  video and read two pages; `--only=comments-order` asked the same page for
  `top`. Three things were measured that the ticket did not predict.

  A nested reply is not on the page. Each parent carries
  `repliesContinuationToken` and `engagement.replies`, so a subtree is another
  credit, and seven of the twenty parents on page one claimed 54 replies
  between them. The connector buys none and reports the page partial, the
  same shape as TikTok's.

  `order=newest` is not date order. A two-year-old comment sat on page two
  behind nineteen four-year-old ones, and `order=top` returned nineteen of the
  same twenty ids. So a thread re-opened because its count grew re-reads mostly
  the same page, and there is no early stop. Sent anyway, because it is what a
  monitor means and it does change the page a little.

  Every comment on a page shares one time of day, to the millisecond: the
  date is the moment of the call minus "4 years ago". Stored approximate, and
  the `since` cut compares at the precision of that text rather than keeping
  everything — the rule on `postedAtIsApproximate` says keep, and "4 years
  ago" against a thirty-day window is not a case that rule was written for.

  Open: the permalink. `&lc=` is YouTube's own highlighted-comment parameter
  and the connector builds it, which by AGENTS.md's rule is evidence about our
  string building and none about YouTube until somebody opens one.
