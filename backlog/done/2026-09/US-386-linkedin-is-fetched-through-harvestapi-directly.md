---
id: US-386
title: LinkedIn is fetched through HarvestAPI directly
type: feature
priority: p1
created: 2026-09-24T07:53+08:00
parent:
area:
resolution: shipped
---

## Context

**LinkedIn is the dearest platform this product fetches, and the same data is
sold for about a twelfth of the price.** Apify runs HarvestAPI's
`linkedin-post-search` actor and bills $0.002 a post on FREE and BRONZE. The
connector buys 25 posts a query, so a LinkedIn poll costs $0.05 against about
$0.01 on every other platform. The hosted product counts a LinkedIn poll as
five for that reason.

HarvestAPI sells the same search directly, at `api.harvestapi.io`, and bills a
**request**, not a post. The prices below were read on 2026-09-24 from the
site's own plan data, `GET api.harvestapi.io/users/subscriptions-info`, which
the pricing page renders:

| Top-up | Post-search requests | Price a request |
|---|---|---|
| $20 Starter | 5,000 | $0.004 |
| $80 Basic | 25,000 | $0.0032 |
| $280 Pro | 121,739 | $0.0023 |
| $780 Business | 390,000 | $0.002 |

It is pay-as-you-go: a top-up, not a subscription, and the credits expire a
year after purchase. The site says a post-search page holds "50–100 items".
If one page covers a query's poll, a poll costs $0.004, not $0.05.

**US-122 named this route and did not price it.** It asked for a *second*
provider and set HarvestAPI aside because it is Apify's own upstream: an
outage there stops both. That is still true, and this ticket does not claim
otherwise. The question here is price, and a replacement does not need a
second upstream.

**The documented post shape is the actor's shape** — `id`, `content`,
`linkedinUrl`, `author.linkedinUrl`, `postedAt.{timestamp,date}` — so the
Apify parser may read it unchanged. That is read from the OpenAPI document,
not measured, and the capture decides it.

**What the capture must answer before a connector is written:**

1. How many posts one page returns, with `sortBy=date`, with and without
   `postedLimit=24h`.
2. What one request costs, from the account balance before and after.
3. What a search matching nothing costs.
4. Whether `id` is the activity id, the same number the Apify connector
   stores, so a post collected there is not stored again.
5. What a refused key says, with what status, and whether it is free.
6. Whether `/users/my-api-user` checks a key without charge.
7. What a comment looks like on `/linkedin/post-comments`: an id, a date, a
   permalink, and whether replies arrive nested.
8. Whether `page=2` works without a `paginationToken`.

## Acceptance

- [x] A capture script beside the fixtures answers the eight questions, and
      its cost is in `docs/instruments.md`
- [x] The fixtures are scrubbed, and a person read every file before commit
- [x] A `harvestapi` provider and a LinkedIn connector exist, priced per
      request at the Starter price, with the page size the capture measured
- [x] `harvestapi` is in `providers` in `vocabulary.ts`, with its migration
- [x] The connector reads comments, if the capture shows they carry an id, a
      date and a permalink
- [x] A key is checked without a charge, or the ticket says why it cannot be
- [x] `.env.example`, `site/self-hosting/keys.md` and `docs/costs.md` name the
      provider and its price
- [x] One live poll through the connector is recorded in the Log, with what it
      cost
- [x] The hosted product's follow-up is written: its LinkedIn connector and
      the LinkedIn poll weight in its plans

## Notes

- [US-122](../done/2026-09/US-122-linkedin-gets-a-second-provider.md) holds the
  eliminations and the reason this route was set aside.
- [US-056](../done/2026-09/US-056-linkedin-is-measured-at-apify.md) holds the
  Apify measurements; the capture here asks the same questions of the same
  upstream.
- Docs: `https://docs.harvestapi.io/llms.txt`. The key travels in `X-API-Key`.
- Concurrency is 1 request on a free account and 5 on Starter. A request past
  the limit queues, up to 10; past that it fails.

## Log

- 2026-09-24T07:53+08:00 — Written. The owner asked for the integration after
  the price comparison above.
- 2026-09-24T08:04+08:00 — **Captured.** Five paid requests, $0.020, read from
  `usage.balance` before and after each one. The eight questions:

  1. **Fifty posts a page**, with and without `postedLimit=24h`. `flaky tests`
     by date reported 273 results in 6 pages; with `24h`, 158.
  2. **$0.004 a request**, exactly, on every paid call.
  3. **An empty search is billed**: $0.004 for zero results.
  4. **`id` is the activity id** on all 150 posts. One is a group post: its
     `linkedinUrl` is `feed/update/urn:li:groupPost:<group>-<other id>`, so the
     id is not inside its URL. The shape is the actor's, field for field, so
     the Apify parsers read it unchanged.
  5. **A refused key answers `401 {"error":{"error":"Invalid API key"}}`**, on
     the search and on the account endpoint alike, and costs nothing.
  6. **`/users/my-api-user` is free**: two reads moved no balance field. It is
     the key check.
  7. **Comments carry an id, a permalink, an ISO date and an actor**, newest
     first, a hundred to a page. The one post captured had four comments and
     no nested replies, so nesting is unmeasured here.
  8. **`page=2` works without a token** and repeats none of page 1.

  `sortBy=date` selects recent posts but does not order them, as on Apify:
  the newest was 47 minutes old, the oldest on the first page ten hours.

  **The scrubber inherited from the Apify capture let four things through**,
  all fixed before commit: a name written into a post's own text ("Follow
  <name> for more"), a name as a hashtag, a recruiter's email address, and a
  bare member number under `author.urn`. It also destroyed a post URL of the
  form `posts/activity-<id>-<hash>`, which carries no person slug. And it
  sliced mention spans in UTF-16 units where LinkedIn counts code points, so
  on a post in styled Unicode letters it replaced the wrong characters and
  kept the name. **The Apify capture still has that last defect**; its
  committed fixtures were not re-checked by this ticket.
- 2026-09-24T08:08+08:00 — **One live poll**, `live:harvestapi-linkedin-poll`,
  against the worktree's copy of the database: 50 posts in one request, all
  50 new beside 120 stored earlier through Apify, and one `api_usage` row of
  1 request at 4,000 micro-dollars. The pre-filter kept all 50, as it does on
  every LinkedIn poll. The model half was the bill: $0.198 on
  `gpt-5.6-terra` before the run's $0.20 cap stopped it, with 2 matches at 50
  or above. The provider half is now a fiftieth of the model half.

  `docs/costs.md` holds rules, not prices, so the price went to the site's
  cost table and the rule that a volume discount is not modelled went to
  `docs/costs.md`. `docker-compose.yml` passes the new key through;
  `compose-environment.test.ts` found the gap.
- 2026-09-24T09:44+08:00 — The hosted follow-up is US-387 there, built
  against this working copy: HarvestAPI for LinkedIn, a LinkedIn poll counted
  as one credit, and Apify as a manual fallback. This ticket stays in doing
  until the release.
- 2026-09-24T13:41+08:00 — Released in 0.16.0 and pinned by the hosted product, which is on
  staging with it.
