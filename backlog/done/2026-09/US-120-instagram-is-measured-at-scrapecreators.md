---
id: US-120
title: Instagram is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:38+08:00
parent:
area:
resolution: shipped
---

## Context

**Instagram has one provider.** SocialCrawl fetches it since US-049 and nothing
else does. The owner asked on 2026-09-11 for every platform to have at least
two. [US-119](US-119-tiktok-is-measured-at-scrapecreators.md) asks the same
questions of the same provider for TikTok and holds the reasoning for why
ScrapeCreators is the candidate: the account exists, the provider id is already
in the schema, and one key reaches every platform behind it. Its API reference
publishes `/v1/instagram/search`, so it can discover rather than only fetch a
URL.

**The number to beat is $0.27 for a thousand reels, and $0.54 for a thousand
comments.** SocialCrawl charges one credit for a search of about thirty reels
and five credits for a page of about fifteen comments, at $0.008118 a credit.
The comment price is the one that matters here, because on Instagram the lead
is in the comments more often than in the caption.

**Instagram is the platform that broke the most rules, so ask everything
twice.** US-049 found three faults that the four sibling endpoints at
SocialCrawl do not have, and each would have shipped silently. Every one of
them is a question for this provider too, and none of the answers carries over:

1. **A search with no date window returned five years of posts**, in relevance
   order, newest five months old. A monitor's `since` would then throw away
   everything it was billed for, every poll.
2. **`has_more` was true beside an empty page.** Reading the flag is a walk
   over nothing that never ends.
3. **Three of nine comment fields were null on every comment** — `url`,
   `post_id` and the author's display name — against 137 captured comments from
   X, YouTube and TikTok that fill all three. BUG-007's wrong-parent check is
   inert on Instagram for that reason. Find out whether it would be inert here.

**The other questions are US-119's, unchanged**: the whole wire shape, whether
the id is Instagram's own and deduplicates against SocialCrawl, what a search
costs in `credits_charged` and what it returns for that, whether a date order
is offered and real, what an invalid parameter value makes the provider say,
what a search matching nothing costs, what the cursor is, what a refused key
says, and whether a credential probe is free.

**Comments are not an extra here; they are the reason.** Ask what one page
costs, how many it returns, and whether each comment carries an id, a date and
a permalink. A comment with no permalink cannot be shown to a person, which is
what stopped US-055 from fetching replies at all.

## Acceptance

- [x] A capture script runs the search with a real key, records what came back,
      and writes `ledger.json` beside the fixtures saying what each call did to
      the credit balance
- [x] The fixtures are scrubbed of handles, names, captions that identify a
      person, and avatar URLs, and were read by a person before being committed
- [x] The three US-049 faults are each asked of this provider and answered in
      the Log, whichever way they come out
- [x] Every question US-119 lists is answered in the Log, or named as
      unanswered with the reason
- [x] The comment endpoint's price, page size and field completeness are
      recorded, without a comment fetch being enabled in the connector
- [x] The run's total cost is recorded, from the provider's own numbers
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it

## Notes

- Read [docs/sources.md](../../docs/sources.md), *adding a provider*, and
  [docs/instruments.md](../../docs/instruments.md) before running anything.
- `scrapecreators/client.ts` still ends its base URL in `/reddit`. US-119 moves
  it up a segment; whichever of the two runs first does that work.
- The capture goes in `scrapecreators/instagram-fixtures/`.
- `socialcrawl/instagram-fixtures/capture.mjs` is the worked example for this
  platform. Read what it asks before writing a new one.

## Log

- 2026-09-11T18:38+08:00 — Written. The owner asked for a second provider on
  every platform.

- 2026-09-11T23:58+08:00 — **Measured. The recommendation is to build it, and
  the decision is not mine to take, because it reverses one the owner took four
  days ago.** The reasoning is below and it is short; the number that matters
  is $0.0019 for fifteen comments against SocialCrawl's $0.0406.

  **This platform has two candidate endpoints, and they fail in opposite
  directions.** That is why this capture asks both.

  **Instagram's own search cannot serve a monitor.** `/v1/instagram/search/popular`
  scrapes the public `/popular/{query}` page, so nothing stands between us and
  the platform. It returns twelve posts a credit, the captions are rich —
  median 570 characters — and the first page for `flaky tests` was genuinely
  about test automation. And **not one post carries a date**. Not `taken_at`,
  not a timestamp under any other name: the nine fields are `id`, `shortcode`,
  `url`, `type`, `caption`, `display_url`, `video_url`, `play_count`, `owner`.
  A monitor cuts on `since`. A post with no date cannot be cut, cannot be
  ordered, and cannot be shown with a date beside it in the inbox. There is no
  parameter that adds one and no second call that would be affordable.

  **Google's index of Instagram does everything else right.**
  `/v2/instagram/reels/search` is, in the provider's own words, "best-effort
  rather than a complete Instagram-native search". It returns ten reels a
  credit and every one of them:

  * **carries a real `taken_at`**, an ISO timestamp with a real time of day —
    not YouTube's computed one;
  * **carries up to fifteen comments inside the search page, at no extra
    charge**, and all 53 captured this way had an `id`, a `text`, an owner and
    a `created_at`. US-049's third fault does not reproduce here: SocialCrawl
    leaves `url`, `post_id` and the author's display name null on every
    Instagram comment, and this provider leaves nothing null;
  * takes a date window, `last-week`, `last-month` or `last-year`. Without one
    the page ran six months, 5 March to 5 September — not the five years
    US-049 found at SocialCrawl, and still wide enough that the window is not
    optional.

  **Three of its refusals are free**, which no other endpoint measured in this
  provider manages. A search matching nothing answers **404 and charges 0**,
  where TikTok returns thirty unrelated videos and bills, and YouTube returns
  an honest empty page and bills. Page 12, one past the documented last page,
  answers **400 and charges 0**. A key with no query answers 400 and charges 0.
  So on this platform a bad query costs nothing, which is the property
  `docs/costs.md` cares about most.

  Page two repeated none of page one's ten, on both endpoints.

  **The comments are the reason to build it.** On Instagram the lead is in the
  comments more often than in the caption. SocialCrawl charges five credits for
  a page of fifteen, which is $0.0406. This provider charges one credit for the
  same fifteen — $0.0019, twenty-one times less — and gives a first page of
  them free inside the search answer. Posts alone are a weaker argument: ten a
  credit is $0.188 a thousand against SocialCrawl's $0.27, only 1.4 times
  cheaper.

  **The objection, and why it is weaker here than it was in US-055.** Four days
  ago the owner dropped a built and passing LinkedIn connector because it found
  posts through Google's index, and a middleman that silently drops posts fails
  in a way no poll would notice. That objection is sound and it applies to this
  endpoint word for word.

  It is not the same decision, for one reason: **US-055 proposed a Google-indexed
  connector as the only one for its platform. This would be the second.**
  SocialCrawl's native Instagram connector stays, stays offered and stays the
  default. A person who wants Instagram's own view keeps it; a person who wants
  comments at a twentieth of the price picks this one and is told, on the
  connections screen, what they are picking. A partial index chosen beside a
  complete one is a trade-off a person makes. A partial index that is the only
  source is a fault they never see.

  **One measurement about coverage, and it is suggestive rather than
  conclusive.** The 24 posts the native endpoint returned across two pages and
  the 28 reels the Google-indexed one returned across three share **no id and
  no shortcode**. Both are nineteen-digit Instagram media ids, so the
  comparison is sound. It proves the two routes see different parts of
  Instagram; it does not prove either is more complete, because the native
  endpoint ranks by what Instagram curates and the other filters by keyword and
  date, and different selection rules alone could produce this. The measurement
  that would settle it is to take reels SocialCrawl finds and ask whether this
  endpoint has them. That needs the SocialCrawl key, which is not in `.env`
  today.

  **The other answers.**

  * *One post on the wire* is `reels-window.json`, whole: `id`, `__typename`,
    `shortcode`, `url`, `caption`, three media addresses, `has_audio`,
    `product_type`, `video_duration`, music attribution, `is_video`, `owner`,
    `taken_at`, `is_ad`, `like_count`, `is_paid_partnership`, `location`,
    `comment_count` and `comments`.
  * *The id is the same one SocialCrawl returns* — a nineteen-digit media id —
    on the Google-indexed endpoint. **The native endpoint prefixes it**:
    `POLARIS_3822902987405051490`. A connector reading that one must strip the
    prefix or the same reel is stored twice.
  * *A credential probe is free*, and a refused key answers 401.
  * *`has_more` beside an empty page*, US-049's second fault, did not
    reproduce. The native endpoint's `has_more` was true beside a full page and
    the Google-indexed one refuses the page past its limit outright.

  **The scrubber was wrong twice, and reading the files caught both.** A
  comment's `user` carries `pk`, Instagram's primary key for a person under a
  name that does not say so, and the field list had been written from what a
  reel's `owner` carries. And handles written inside captions needed
  pseudonymising, which is the third capture in a row to meet that.

  **I made the same mistake as the YouTube capture, an hour later.** The first
  run asked the *first* reel for its comments. It had none, so the page came
  back empty and billed. `comment_count` is in the search answer. Read it
  before choosing a target — the script does now, in both captures.

  The run committed here spent 6 credits and the corrections spent 8 more.
  Fourteen credits is about $0.026.

  **What is not proven.** Nothing has polled through this provider, no
  connector exists, and the coverage question above is open by design. Every
  number here is one keyword on one day.
