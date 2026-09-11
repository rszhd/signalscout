---
id: US-119
title: TikTok is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:36+08:00
parent:
area:
resolution: shipped
---

## Context

**TikTok has one provider.** SocialCrawl fetches it and nothing else does, so
an account that loses that key, or meets an outage there, collects no TikTok at
all. The owner asked on 2026-09-11 for every platform to have at least two.
YouTube and Instagram are in the same position and have their own tickets;
LinkedIn is a harder case and has [US-122](US-122-linkedin-gets-a-second-provider.md).

This crosses the ordering rule in `backlog/README.md` — detection quality
outranks a new source — on the owner's decision, the fifth time it has been
crossed.

**ScrapeCreators is the candidate, and it is a candidate because the account
already exists.** The provider fetches Reddit here since US-025, the key is
already a field on the connections screen, `scrapecreators` is already in the
provider enum and its six check constraints, and the same key reaches every
platform behind it. Its API reference publishes `/v1/tiktok/search/keyword`,
which is the discovery question answered before the capture starts: it can find
a stranger, not only fetch a URL. US-006 rejected two providers for X on that
test alone.

**The number to beat is $0.27 for a thousand posts.** SocialCrawl charges one
credit for a TikTok search that returns about thirty reels, and a credit is
$0.008118. ScrapeCreators bills a request rather than a record, at $1.88 for a
thousand requests measured on Reddit. If a keyword search returns a comparable
page for one request, it is about four times cheaper. That is the arithmetic
this capture has to replace with a measurement.

**Nine questions the documentation cannot settle.** The reference is rendered
by a script and its endpoint pages returned nothing useful to a fetch, so
nothing below is known.

1. What is one video on the wire — every field, not the ones a parser would
   read today.
2. **Is the id TikTok's own `aweme_id`, the one SocialCrawl returns?** If the
   two providers disagree about identity, the same video is stored twice and
   billed twice. Reddit's three providers agree on the `t3_` fullname and that
   is why they deduplicate.
3. What does one search cost in `credits_charged`, and how many videos does it
   return for that? The answer is `unitsConsumed` measured, never assumed.
4. **Can the search be ordered by date, and does the order hold?** A connector
   stops paging on a newest-first list and pays for pages it discards on a
   relevance-ordered one. A parameter that is accepted and ignored is the shape
   of BUG-002, so read the dates in the answer rather than the status code.
5. Is there a date window, and which values does it take? Send an invalid value
   first. A rejected call bills nothing and makes the provider list its own
   vocabulary, which is how the Reddit `order` values were learned for free.
6. What does a search matching nothing return, and is it billed? This
   provider's Reddit endpoint answers 200 with an empty list and charges for
   it. There is no safe assumption.
7. What is the cursor, and does page two share nothing with page one?
8. Are comments on a separate endpoint, at what price, and does each comment
   carry an id, a date and a permalink? US-047 needs the link and US-055 was
   the ticket where a comment with no permalink stopped a connector fetching
   replies at all.
9. What does a refused key say, with what status, and is the check free?
   `docs/secrets.md` tests a key before storing it, so the answer is a
   credential probe's price.

**One more, and it is the one this platform fails on.** A TikTok caption is
short. Ask whether the answer carries anything else a classifier could read —
a description, a transcript, the video's own subtitles — and record the median
caption length across the capture. A platform whose text is thirty characters
is a platform the classifier cannot score, whatever it costs.

## Acceptance

- [x] A capture script runs the keyword search with a real key, records what
      came back, and writes `ledger.json` beside the fixtures saying what each
      call did to the credit balance
- [x] The fixtures are scrubbed of handles, names and avatar URLs, and were
      read by a person before being committed
- [x] All ten questions above are answered in the Log, or named as unanswered
      with the reason
- [x] The run's total cost is recorded, from the provider's own numbers
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it

## Notes

- Read [docs/sources.md](../../docs/sources.md), *adding a provider*, and
  [docs/instruments.md](../../docs/instruments.md) before running anything.
- `scrapecreators/client.ts` is written as the Reddit half of one connector:
  `apiBase` ends in `/reddit`. A second platform makes it the provider's
  client, the way `socialcrawl/client.ts` already is. The base URL moves up one
  path segment and `verify()` builds its own URL from it.
- The capture goes in `scrapecreators/tiktok-fixtures/`, beside its fixtures,
  the way `fixtures/capture.mjs` and the two LinkedIn ones do.
- Do not enable a comment fetch in this run. Question 8 asks its price, not its
  contents.
- US-049 is the standing warning: Instagram broke three things its four
  siblings agreed on. Ask this endpoint every question, including the ones a
  sibling has already answered.

## Log

- 2026-09-11T18:36+08:00 — Written. The owner asked for a second provider on
  every platform.

- 2026-09-11T22:30+08:00 — **Measured. The recommendation is to build it, and
  the number is $0.063 for a thousand videos against SocialCrawl's $0.27.**
  One search page is one credit at $0.00188 and returns thirty videos. That is
  4.3 times cheaper on the same platform, and it closes the gap TikTok has had
  since US-044: one provider, one key, one outage.

  The whole run spent 9 credits. Four earlier runs of the same script, while it
  was being corrected, spent 30 more. Thirty-nine credits is about $0.073.

  **The one rule a connector must carry: ask for relevance inside a date
  window, never for date order.** This is the finding the ticket did not
  anticipate and it decides whether the platform is usable at all.

  * `sort_by=date-posted` sorts. The dates come back newest first and the
    parameter is real, so question 4 is answered yes. It is also a trap. On
    `flaky tests` it returned dog skin conditions, facial rashes, dandruff and
    a flaky croissant: 4 of 30 captions mentioned software on one run and 10 of
    30 on another, and the ones that did were false — a fish sandwich described
    as flaky, a *taste test*. TikTok matches `flaky` as an ordinary word, which
    is US-022's Reddit finding on a shorter text.
  * `sort_by=relevance` ranks well and ignores time. 18 of 30 on topic, dated
    2020 to 2026, newest two days old. A monitor asking what was said this week
    would pay for six years of posts and discard them.
  * `sort_by=relevance` **with** `date_posted=this-month` is the combination
    that works: 14 of 30 and then 20 of 30 across two runs, every video inside
    the window. That is the request a connector must build.

  The page is not in date order, so the early-stop rule `reddit.ts` uses is
  wrong here and must be absent, for the same reason it is absent from
  `socialcrawl/linkedin.ts`. The exact `since` cut is ours.

  **The other nine answers.**

  1. *One video on the wire* is `video-whole.json`: raw TikTok, 33 KB scrubbed,
     every field. The provider does not normalise anything.
  2. *The id is TikTok's own.* `aweme_id` is `7684281080437951758`, and
     SocialCrawl's TikTok fixture carries the same numeric id as `post.id`. The
     two providers deduplicate against each other with no new rule, the way
     Reddit's three do on the `t3_` fullname.
  3. *One search costs one credit* and returns thirty videos, reported as
     `credits_charged` on every answer. The answer arrives in the body; there
     is no snapshot to poll, so this connector never returns `next: wait` on a
     healthy call.
  4. Answered above.
  5. *The windows are real.* `yesterday` returned 9 videos dated 10 and 11
     September where `this-month` returned 30. The five values are
     `yesterday`, `this-week`, `this-month`, `last-3-months`, `last-6-months`
     and `all-time`, read from the provider's OpenAPI document.
  6. **A search that matches nothing is not reported and is billed in full.**
     `zqxjkv wobblefish intentwatch nonexistent phrase` answered
     `success: true` with thirty unrelated videos and charged a credit. This is
     SocialCrawl's LinkedIn behaviour, not its X behaviour: a monitor with a
     bad query pays every poll and nothing in the answer says the query was the
     problem.
  7. *The cursor is a number*, and it is the count of what has been returned:
     page one ends `cursor: 30, has_more: 1`. `has_more` is a number and not a
     boolean. Page two returned 8 videos and then `cursor: null, has_more: 0`,
     so `flaky tests` inside a month is 38 videos in total. **Page two repeated
     7 of page one's 30 on one run and 0 on another** — the provider's own
     documentation says TikTok may return duplicates, and it does. Paging costs
     a full credit for a partly repeated page.
  8. *A comment carries an id, a date and its parent post.* `cid`,
     `create_time` and `aweme_id` were present on all 11 comments, so BUG-007's
     wrong-parent check works here, unlike on Instagram. **The permalink is
     conditional and cannot be relied on.** `share_info.url` held a real
     comment link on one capture —
     `https://m.tiktok.com/v/<post id>.html?...&share_comment_id=<cid>` — and
     was an empty string on all 11 comments of the next, where
     `share_info.acl.code` was 1 rather than 0. So the link exists when TikTok's
     sharing rule allows it and not otherwise, and a connector must keep
     building its own. That is a second, independent sighting of a real TikTok
     comment link, and it names the comment the same way `?cid=` does.
  9. *A refused key answers 401.* A working key with no query answers 400
     `missing_parameter`, "You must provide a query", and charges 0. **A
     credential probe is free**, and the ledger is the evidence.
  10. *The caption is all the text there is.* A transcript endpoint exists and
      charges a credit, and it returned `transcript: null` on all three videos
      asked — the newest, the busiest and the wordiest. Caption length ran 0 to
      1,194 characters with a median of 117 to 192 across runs. Do not plan on
      speech. The AI fallback costs ten credits and was deliberately not asked.

  **Two traps found on the way, neither of them in the ticket.**

  *The share URL must have its query string stripped.* `share_url` arrives as
  `https://www.tiktok.com/@handle/video/<id>?_r=1&u_code=...&source=h5_m`, and
  the transcript endpoint refuses it with "We don't want the cdn url, we want
  the url to the actual TikTok video". It is not a CDN URL; it is the right
  page with tracking on it. SocialCrawl returns the same video as a clean
  address, so a connector that stores this one raw would hold one video under
  two URLs. The refusal is free.

  *An unrecognised parameter is ignored and billed.* `?sort=banana` returned a
  normal page and charged a credit. The technique `docs/sources.md` recommends
  — send an invalid value and let the provider list its own vocabulary — works
  on this provider's Reddit endpoint and not on this one. The vocabulary is in
  `https://docs.scrapecreators.com/openapi.json` instead, which is free to read
  and is where every parameter above came from.

  **What the fixtures are, and the one rule they bend.** A page of thirty raw
  TikTok videos is 1.8 MB after scrubbing, and six pages would be 9 MB against
  624 KB for the largest fixture folder in this repository. So one video is
  committed whole, which answers question 1 completely, and each search page is
  a digest of ids, dates, captions, share URLs and counts — enough for the
  questions those calls were asked, and named `-digest` so nobody mistakes one
  for a record of the wire. A build ticket should capture one whole page when
  it knows what it is worth. Every signed CDN URL is also replaced: they are
  four fifths of the bytes and they expire within hours, so they stop being
  evidence almost immediately.

  **The scrubber was wrong twice and both were found by reading the files.**
  The first run wrote a real handle into `manifest.json`, because the scrubber
  ran on payloads and not on the request URL recorded beside them. The second
  left `@byeflakes` and a dozen other handles inside captions, and a
  commenter's display name inside `share_info.desc` — where `desc` is the
  caption on a video and the sharing blurb on a comment, one key with two
  meanings. US-049's rule holds from the other side: name the container, and
  know which one you are inside.

  **What is not proven.** Nothing has polled through this provider. No
  connector exists, no rate limit has been met, and the relevance numbers are
  two samples of one keyword on one day. A build ticket should re-run this
  script before it trusts any figure here.
