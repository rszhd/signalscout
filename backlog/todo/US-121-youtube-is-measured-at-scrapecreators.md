---
id: US-121
title: YouTube is measured at ScrapeCreators
type: spike
priority: p2
created: 2026-09-11T18:40+08:00
parent:
area:
resolution:
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

- [ ] A capture script runs the search with a real key, records what came back,
      and writes `ledger.json` beside the fixtures saying what each call did to
      the credit balance
- [ ] The fixtures are scrubbed of channel names and any identifying field, and
      were read by a person before being committed
- [ ] Every question US-119 lists is answered in the Log, or named as
      unanswered with the reason
- [ ] Whether a transcript is available, on which endpoint and at what price,
      is recorded
- [ ] What a search answer mixes in beside videos is recorded, and whether it
      can be asked for videos alone
- [ ] The run's total cost is recorded, from the provider's own numbers
- [ ] The ticket ends with a recommendation: build the connector, or do not,
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
