---
id: US-119
title: TikTok is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:36+08:00
parent:
area:
resolution:
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

- [ ] A capture script runs the keyword search with a real key, records what
      came back, and writes `ledger.json` beside the fixtures saying what each
      call did to the credit balance
- [ ] The fixtures are scrubbed of handles, names and avatar URLs, and were
      read by a person before being committed
- [ ] All ten questions above are answered in the Log, or named as unanswered
      with the reason
- [ ] The run's total cost is recorded, from the provider's own numbers
- [ ] The ticket ends with a recommendation: build the connector, or do not,
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
