---
id: US-121
title: YouTube is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:40+08:00
parent:
area:
resolution: shipped
---

## Context

**YouTube has one provider.** SocialCrawl fetches it since US-034 and nothing
else does. The owner asked on 2026-09-11 for every platform to have at least
two. [US-119](US-119-tiktok-is-measured-at-scrapecreators.md) holds the
reasoning for why ScrapeCreators is the candidate. Its API reference publishes
`/v1/youtube/search`, so it can discover.

**The number to beat is $0.18 for a thousand videos.** SocialCrawl charges one
credit for a search that returns about forty-five videos, at $0.008118 a
credit. This is the cheapest platform we fetch, so the cost argument for a
second provider is weaker here than on TikTok or Instagram. Availability is the
argument: one key and one provider is one outage away from collecting nothing.
Say so in the recommendation rather than forcing the price to win.

**YouTube has one thing no other platform here has: a transcript.** A video's
title and description are thin, and the classifier reads text. Ask whether this
provider returns a transcript or captions, on which endpoint and at what price.
If it does and SocialCrawl does not, that is a reason to build this connector
that has nothing to do with the price of a search.

**The questions are US-119's, unchanged**: the whole wire shape, whether the id
is YouTube's own eleven-character video id and so deduplicates against
SocialCrawl, what a search costs in `credits_charged` and what it returns for
that, whether the search can be ordered by date and whether the order holds,
which date window values the provider accepts when sent an invalid one, what a
search matching nothing costs, what the cursor is, whether comments carry an
id, a date and a permalink, what a refused key says, and whether a credential
probe is free.

**One question this platform adds.** YouTube search returns channels, playlists
and shorts beside videos. Find out what the answer mixes in, and whether a
parameter can ask for videos alone. A parser that takes the first ten results
may be storing three channels.

## Acceptance

- [x] A capture script runs the search with a real key, records what came back,
      and writes `ledger.json` beside the fixtures saying what each call did to
      the credit balance
- [x] The fixtures are scrubbed of channel names and any identifying field, and
      were read by a person before being committed
- [x] Every question US-119 lists is answered in the Log, or named as
      unanswered with the reason
- [x] Whether a transcript is available, on which endpoint and at what price,
      is recorded
- [x] What a search answer mixes in beside videos is recorded, and whether it
      can be asked for videos alone
- [x] The run's total cost is recorded, from the provider's own numbers
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it. Availability is an allowed reason; say so
      plainly if the price does not justify it

## Notes

- Read [docs/sources.md](../../docs/sources.md), *adding a provider*, and
  [docs/instruments.md](../../docs/instruments.md) before running anything.
- `scrapecreators/client.ts` still ends its base URL in `/reddit`. US-119 moves
  it up a segment; whichever of the three runs first does that work.
- The capture goes in `scrapecreators/youtube-fixtures/`.

## Log

- 2026-09-11T18:40+08:00 — Written. The owner asked for a second provider on
  every platform.

- 2026-09-11T23:20+08:00 — **Measured. The recommendation is to build it, and
  the price is not the reason.** One search page is one credit at $0.00188 and
  returns twenty videos, so $0.094 for a thousand against SocialCrawl's $0.180.
  Twice as cheap is real but thin, and the ticket said in advance that
  availability would have to carry this one.

  It does not have to. **This provider returns the description and the
  transcript, and the incumbent returns the title.**

  * A title is 68 characters at the median. That is what
    `socialcrawl/youtube.ts` gives the classifier today, and it is the thinnest
    text of any platform in this product.
  * `includeExtras=true` returns a description on 20 of 20 videos, median 1,413
    to 1,620 characters across two runs. Same one credit, and 3.7 seconds
    instead of 1.3.
  * The transcript endpoint works, at one credit a video: 31,971 characters on
    one video and 8,634 on another. TikTok's returned null on all three asked.

  So a YouTube match scored through this provider is scored on twenty times the
  text, at half the price. That is the number that decides it.

  The run committed here spent 8 credits. Getting to it spent 15 more, most of
  them on a wrong turn described below. Twenty-three credits is about $0.043.

  **`includeExtras` is not optional, and the second reason is worse than the
  first.** `publishedTime` is an ISO timestamp and it is computed, not read:
  every video in one answer carried the same time of day, because the provider
  subtracts "3 weeks ago" from the moment of the call. `publishDate` is the
  real timestamp, with a real time of day and a real offset, and it arrives
  only with `includeExtras`. A `since` cut made on `publishedTime` is wrong by
  up to a day on every poll. The capture prints the check, so a future run
  cannot miss it.

  **The other answers.**

  1. *One video on the wire* is `search-videos.json`, whole: `type`, `id`,
     `url`, `title`, `thumbnail`, `channel`, two view counts, two published
     fields, two length fields and `badges`. The provider normalises YouTube
     rather than passing it through, which is why these fixtures are whole
     where TikTok's are digests — a page of twenty is 15 KB.
  2. *The id is YouTube's own.* `id` is the eleven-character video id and `url`
     is `https://www.youtube.com/watch?v=<id>` with nothing appended.
     SocialCrawl returns the same id and the same URL shape, so the two
     providers deduplicate with no new rule and, unlike TikTok, nothing has to
     be stripped first.
  3. *One search costs one credit* and returns twenty videos, reported as
     `credits_charged`. The answer is in the body; there is no snapshot.
  4. **The answer is not in date order and cannot be asked for in date order.**
     `sortBy` takes `relevance` and `popular` and nothing else. So the
     early-stop rule is absent here, as it is on LinkedIn, and the `since` cut
     is ours. Unlike TikTok, relevance is the only ranking and it is a good
     one: the first page was on topic without any window at all.
  5. **`uploadDate` narrows, and it leaks.** `today` returned 12 videos, 9 of
     them hours old and 3 of them two and three weeks old. It is worth sending
     — it is the difference between 12 results and 20 — but it is not a filter
     a connector may trust. Apply the real cut here, against `publishDate`.
  6. **A search matching nothing answers honestly and is still billed.** The
     impossible phrase returned `videos: 0` and every other array empty, and
     charged a credit. That is better than TikTok, which returns thirty
     unrelated videos and claims success, and it still means a bad query costs
     a credit a poll.
  7. *The cursor is `continuationToken`*, an opaque string. Page two returned
     20 videos and repeated **none** of page one's 20. TikTok repeated seven.
  8. *A comment carries an id and an author and no permalink.* `id`, `content`,
     `publishedTime`, `replyLevel`, `author` and `engagement`. There is no link
     to the comment and no parent post id, so the connector builds the link and
     knows the parent from what it asked for. The comment's date is derived
     from "3 weeks ago" the same way a video's is, and there is no
     `includeExtras` for comments — so a comment's timestamp is approximate and
     nothing here can fix it.
  9. *A refused key answers 401.* A working key with no query answers 400,
     "You must provide a query", and charges 0. **A credential probe is free.**
  10. Answered above.
  11. **Nothing is mixed in.** The answer is one array per kind — `videos`,
      `channels`, `playlists`, `shorts`, `shelves`, `lives` — so a parser
      reading `videos` cannot store a channel by accident. Without `type` the
      same query returned 19 videos, 25 shorts, a playlist and a live stream,
      all in their own arrays. `type=videos` is still worth sending, because a
      short is not a conversation.
  12. Answered above.

  **The wrong turn, because it cost more than the run did.** The first capture
  asked the first video it found for its comments, got an empty page, and
  billed a credit. Reading that as this provider's known Reddit fault — where
  `sort` is accepted and answers zero comments while charging — I then spent
  three more credits proving that `order=top`, `order=newest` and no `order` at
  all all return nothing. They do, and the parameter is innocent: **one video
  in twenty in this niche has a single comment**, and the rest have none. The
  capture now picks its comment target by `commentCountInt`, which only
  `includeExtras` reports. A cheaper instinct would have been to read the count
  before believing the parameter.

  That finding outlives the mistake: **YouTube comments are not where the
  leads are on this keyword.** One comment across twenty videos, and it was
  "nice video sir". The description and the transcript are the text worth
  paying for here, not the thread.

  **The scrubber was wrong once**, and reading the files caught it: two channel
  handles written inside video descriptions, `@testsystemslab` and `@Dropbox`,
  where the rule only looked at strings holding a YouTube URL. The description
  is text this product classifies, so it is kept and the mention is
  pseudonymised. This is the same fault the TikTok capture had with captions,
  found the same way, two hours earlier.

  **What is not proven.** Nothing has polled through this provider. No
  connector exists, no rate limit has been met, and every number here is one
  keyword on one day.
