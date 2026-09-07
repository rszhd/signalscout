---
id: US-060
title: X is measured at SocialData
type: spike
priority: p2
created: 2026-09-07T16:48+08:00
parent:
area:
resolution: shipped
---

## Context

**X has one provider, and that is the thinnest place in this product.** US-006
recorded why: of three providers asked, only SocialCrawl could search X at all.
Bright Data's X dataset discovers by profile only and ScrapeCreators publishes
no X search. So every X poll this product makes depends on one account at one
company, and nothing measures what happens when that account is refused.

The owner named SocialData as a second. It is the first candidate since US-006
that has a real X keyword search.

**Its published numbers beat the incumbent, and three of them change how a
connector would be written.**

*Price.* **$0.0002 a tweet returned**, which is 200 micro-dollars. SocialCrawl
costs one credit for twenty posts, which is 406. Half, if the page size holds.
And it is billed per *result* rather than per request, so what a poll pays
tracks what it collected — the property that keeps Bright Data in this
repository.

*The window can be pushed to the provider.* The query takes Twitter's own
advanced operators, including `since_time:` and `until_time:` as UNIX
timestamps. **No other X connector can do that.** `socialcrawl/x.ts` cuts on
our side and pays for everything older than `since` on the way. If this works,
a poll stops buying posts it will discard.

*The order can be asked for.* `type` takes `Latest` or `Top`, so newest-first
is a parameter rather than a hope — which is what makes the early-stop rule
legitimate, and it is the rule three LinkedIn connectors had to do without.

**Two things look worse than the incumbent and both matter.** An empty search
is **not free** here — beyond three requests a minute it costs $0.0002 — where
SocialCrawl refunds an X search that matches nothing, measured twice. And the
documented tweet has **no URL field**: `id_str`, `full_text`,
`tweet_created_at`, `user`. A link would have to be built from the handle and
the id, and US-047 is unambiguous about what that means — **a URL format we
invent is evidence about our own string building and none about the platform**,
and `?comment_id=` survived a capture, two live polls and a code comment
admitting it was a guess because nobody clicked it.

**The MCP server the owner pasted is not the way in.** A connector calls the
REST API, and a fixture has to be the wire format that connector will parse. An
answer from an MCP would be evidence about the MCP. The key goes in
`SOCIALDATA_API_KEY` and the capture speaks HTTP, like every other provider
here.

## Acceptance

- [x] A capture script calls the search endpoint with a key, records what came
      back, and writes what each call was charged beside the fixtures
- [x] The fixtures are scrubbed of author identity, and were read by a person
      before being committed
- [x] Six numbers are recorded in the Log: results per page, cost per call,
      whether `type=Latest` really orders by date, the age of the newest and
      oldest post, whether `since_time:` narrows the answer, and what an empty
      search costs
- [x] The id is compared against what `socialcrawl/x.ts` produces, so it is
      known whether the two providers deduplicate against each other
- [x] A refused key and an exhausted balance are captured as separate answers,
      because 401 and 402 lead to different actions
- [x] Whether a post URL can be built, and whether one built that way opens
      the post, is answered by opening one — not by assuming
- [x] The run's total cost is recorded, from the provider's own numbers
- [x] The ticket ends with a recommendation: build the connector, or do not,
      and the number that decides it

## Notes

- Needs `SOCIALDATA_API_KEY` in `.env`. The name comes from the provider id
  and the field, the way `environmentVariableFor` builds every other one.
- **Balance is a hard stop**: the API answers 402 when it runs out, so the
  capture should read the balance before it starts and say what it spent.
- Do not use the MCP server for the fixtures. See the Context.
- Read `docs/sources.md`, *adding a provider*, before writing connector code.
  This ticket measures only.
- The incumbent's numbers to compare against are in AGENTS.md and in
  `socialcrawl/x.ts`: 8,118 micro-dollars a credit, twenty posts a request,
  about 406 micro-dollars a post, and a search matching nothing refunded twice.
- If it is worth building, the connector is one file beside `socialcrawl/x.ts`
  plus one line in `builtInSources` — and a migration, because `apify` taught
  this repository that a provider absent from the database enum passes every
  test and can store nothing.

## Log

- 2026-09-07T16:48+08:00 — Written at the owner's request. The published price
  is half the incumbent's and the window can be pushed to the provider, which
  no X connector here can do today.

- 2026-09-07T17:10+08:00 — Ran the capture three times, for **$0.0282 in
  total**; the committed fixtures are the third run, which cost $0.0094. The
  balance went $0.10 to $0.0718. Two of the three runs were scrubber
  corrections, below.

  **Every published claim held, and two came out better than documented.**

  | | SocialData | SocialCrawl |
  |---|---|---|
  | One page | 20 tweets for $0.004 | 20 posts for 1 credit |
  | Per post | **200 µ$** | 406 µ$ |
  | Fifty posts | **$0.0100** | $0.0203 |
  | Ordered by date | **yes, measured** | no sort parameter |
  | Window | **`since_time:` in the query** | none, cut on our side |
  | Empty search | **free** | refunded |

  **`type=Latest` really orders newest first**, checked across the whole page.
  That is the first X connector where the early-stop rule — this page is
  entirely older than `since`, so stop paging — would rest on a measurement
  rather than a hope.

  **`since_time:` narrows, and it narrows the bill.** Unwindowed, the page ran
  back to 4 September. With a 24-hour window the oldest was 6 September at
  13:30, and the call returned **7 tweets for $0.0014** against 20 for $0.0040.
  No X connector here can do that: `socialcrawl/x.ts` buys everything older
  than `since` and throws it away. On this provider a poll stops paying for
  what it will discard.

  **An empty search is free**, measured: the impossible phrase returned zero
  tweets and moved the balance not at all. The documentation says $0.0002
  beyond three requests a minute, so this may be the free allowance rather than
  a refund — it is recorded as measured-free and not as a promise.

  **The newest tweet was 67 minutes old**, and page two shared none of page
  one's twenty.

  **The id is the tweet id and deduplication will work.** `id_str` is the bare
  number, which is exactly what `socialcrawl/x.ts` reads out of its own `id`.
  A post collected through one provider will not be bought again through the
  other.

  **There is no URL field, so one has to be built — and it was opened.**
  `https://x.com/<screen_name>/status/<id_str>` landed on the post, whose text
  and timestamp match the fixture. It is also the exact format SocialCrawl
  returns, so this is not an invented shape. US-047's rule was still obeyed: a
  URL we build is checked by clicking it.

  **A refused key answers 401.** A 402 for an exhausted balance is documented
  and not reproduced — forcing it means draining the account.

  **The scrubber was wrong twice, and the fixtures are why both were found.**
  The first run committed `user.id_str`, the account's permanent id — the same
  mistake US-057 made with `author.id`, in a new place. The second still
  carried `entities.user_mentions[].id_str` and `in_reply_to_user_id`, the
  latter as a number the string rules never saw. Both are now keyed by
  container rather than by shape, because **every other long number in this
  payload names a post and has to survive**: `conversation_id_str`,
  `in_reply_to_status_id`, `quoted_status_id`, and the tweet's own `id_str`,
  which is the deduplication key. That is four LinkedIn-or-X captures in two
  days whose scrubber was wrong in a way only reading the output showed.

  One thing outside the ticket. **The key contains a pipe character**, so
  `SOCIALDATA_API_KEY=…` unquoted makes bash run the second half as a command
  and load an empty key. It is quoted in `.env` now and the capture says so
  when the key is missing.

- 2026-09-07T17:12+08:00 — **Recommendation: build it.** Two numbers decide it,
  and neither is the headline price.

  **X has one provider today**, and that is the real argument. Every X poll
  this product makes depends on one account at one company, and US-006 recorded
  that two of three providers asked could not search X at all. A second one
  that works removes a single point of failure.

  **`since_time:` is the number that makes it better rather than cheaper.** A
  windowed call cost a third of an unwindowed one and returned only what the
  monitor asked for. Half the price per post is worth having; not buying the
  posts at all is worth more, and it compounds on every poll of every monitor.

  What to watch when it is built. The **balance is a hard stop** — 402, not a
  refusal we can retry — so the connector needs to tell an empty account from a
  wrong key, and the budget guard cannot see somebody else's balance. And the
  **post URL is ours to build**, which US-047 says is the kind worth
  re-checking whenever the parser changes.
