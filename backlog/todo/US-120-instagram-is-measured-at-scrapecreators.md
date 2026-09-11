---
id: US-120
title: Instagram is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:38+08:00
parent:
area:
resolution:
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

- [ ] A capture script runs the search with a real key, records what came back,
      and writes `ledger.json` beside the fixtures saying what each call did to
      the credit balance
- [ ] The fixtures are scrubbed of handles, names, captions that identify a
      person, and avatar URLs, and were read by a person before being committed
- [ ] The three US-049 faults are each asked of this provider and answered in
      the Log, whichever way they come out
- [ ] Every question US-119 lists is answered in the Log, or named as
      unanswered with the reason
- [ ] The comment endpoint's price, page size and field completeness are
      recorded, without a comment fetch being enabled in the connector
- [ ] The run's total cost is recorded, from the provider's own numbers
- [ ] The ticket ends with a recommendation: build the connector, or do not,
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
