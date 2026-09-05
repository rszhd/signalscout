---
id: US-028
title: LinkedIn returns candidate posts through SocialCrawl
type: feature
priority: p2
created: 2026-09-05T22:25+08:00
parent:
area:
resolution: shipped
---

## Context

LinkedIn is the third platform. It is in PLAN.md's list of potential sources,
and it is the one where the people describing a problem are most often the
people who buy software to fix it.

**PLAN.md says not to add it yet, and the owner decided to add it anyway.**
The rule is at PLAN.md's *Important rule*: "Do not add another social network
until Reddit + X reliably produce useful matches." That condition is not met.
X has run one poll, and the five verdicts US-012 collected say the classifier
scored three career questions the same as two real buyers. The rule exists
because twenty noisy sources are worse than two good ones, and nothing in this
ticket makes detection better. The owner asked for LinkedIn on
2026-09-05T22:20+08:00 knowing that. It is written here so the next reader
finds a decision rather than an oversight.

**SocialCrawl can search LinkedIn, so this is not X's elimination story.**
US-006 reached SocialCrawl because it was the only provider of three that
could search X at all. Here the provider's documentation lists
`GET /v1/linkedin/search/posts` — public posts and Pulse articles by keyword.
Bright Data and ScrapeCreators were not asked about LinkedIn, so this ticket
claims nothing about them.

Three claims from that documentation shape the work, and all three are claims
until the capture run answers them:

* **It costs 5 credits, where the X search costs 1.** At the 8,118
  micro-dollars per credit that `x.ts` records, one LinkedIn request is about
  $0.041. That is the dearest call in this product — five times an X page and
  twenty-seven times a Bright Data Reddit record.
* **No cursor is documented for it.** Every search connector we have follows
  one. If there is really one window per query, the connector answers `done`
  after one page and `maxUnitsPerQueryPoll` is one request.
* **The provider calls it best effort**, and says it reads public search
  results rather than LinkedIn's own index.

Two design points follow, and both are decided here rather than in the code.

**The billable unit is the credit, not the request.** `x.ts` calls its unit a
request only because one X request is one credit. At five they are different
numbers, and a connector that reports `unitsConsumed: 1` against a price of
8,118 would tell the budget guard a LinkedIn poll cost a fifth of the bill.

**The query length rule is measured, not chosen.** US-006 set X's four words by
running a long phrase and a short one against the live API. A LinkedIn post is
long-form, so eight words is the plausible answer, and plausible is not
measured. The capture run asks the same question the same way.

## Acceptance

- [x] `capture.mjs` for LinkedIn is committed, has been run against a live
      account, and its `ledger.json` records what every call cost in the
      provider's own numbers
- [x] The Log answers each question the capture asks, including whether the
      answer reports `credits_used`, whether a cursor exists, and what a search
      matching nothing is billed
- [x] `linkedin` is a platform in `sources/platforms.ts` and in the
      `posts.source` check constraint, through one migration, with a
      `maxQueryWords` the Log justifies with a live measurement
- [x] One connector pairs the LinkedIn platform with the SocialCrawl provider,
      declares its billable unit as the credit, and reports `unitsConsumed`
      from the provider's own answer and never from a post count
- [x] A post carries an id that deduplicates: two polls of the same query store
      one row — proven against the provider, not yet against `posts`
- [x] An invalid credential fails validation with the provider's own sentence,
      and an unreachable provider is a different answer
- [x] The connector is registered in `builtInSources` and no screen, no route
      and no worker step needed a case for it
- [x] One live poll runs through the worker, stores real posts, and the Log
      holds the count, the cost and what the model made of them

The seventh box passed only after a fix. It was **false when first checked, and
the failure is the useful part**:
the inbox had a two-way branch, `match.source === "x" ? "X" : "Reddit"`, that
would have labelled every LinkedIn match "Reddit". It is now a table keyed by
platform, so the next platform adds a row. The claim the box makes is worth
keeping honest — a screen that decides "not X, so Reddit" is a case, even
though it does not read like one.

The eighth box was added after the fact, when the owner asked for the live poll
in the same session. It is the one that matters most, and it now holds.

## Notes

* `packages/core/src/sources/providers/socialcrawl/` holds the provider and the
  X connector. The client there is X-specific: its base URL is `/v1/twitter`
  and its page parser reads `data.next_cursor`.
* Fixtures go in a folder of their own rather than beside X's. Two capture
  scripts writing one `manifest.json` would mean a full run of either erasing
  the other's record.
* docs/sources.md, *Adding a platform*, is the list this follows.

## Log

- 2026-09-05T22:25+08:00 — Written. The provider's documentation was read for
  `GET /v1/linkedin/search/posts`: 5 credits, parameters `query`,
  `date_posted`, `content_type`, `from_company`, `from_member`, and no
  pagination named. Nothing in this ticket treats that page as evidence.

- 2026-09-05T22:30+08:00 — Ran the capture against the live account, twice. The
  first run is not the one committed: it wrote real names and real job
  headlines into the fixtures. The scrubber decided what a person was by
  sniffing for `headline` and `public_identifier`, and this provider uses
  neither — it puts a person under `author` as `{ name, description, url,
  avatar }`, and the avatars were four signed `media.licdn.com` URLs that no
  field-name rule caught. Fixed by naming the container instead of guessing at
  its contents, and re-run. Nothing leaked: the first run was never committed.
  The lesson is in docs/sources.md — read the fixtures your own script wrote.

- 2026-09-05T22:36+08:00 — What the capture answered. Nine questions, and four
  answers contradict the X endpoint behind the same key.

  **The envelope reports everything.** `credits_used: 5` on every billed call,
  `credits_remaining` beside it, and `success`, `request_id` and `cached` in the
  same object. So `unitsConsumed` is measured, and the five-credit price the
  documentation claims is confirmed rather than trusted.

  **It pages, and the documentation says it does not.** The cursor is at
  `pagination.next_cursor` with `has_more` beside it. Page two returned ten
  posts and **none of page one's ten** were among them.

  **The ids are stable.** The same query sent twice returned the same ten ids
  in the same order, which is what deduplication rests on.

  **`date_posted` is honoured.** The provider named its own values when the
  capture sent an invalid one: `past_24h, past_week, past_month`. With
  `past_week` the oldest post moved from 15 August to 30 August against a run
  on 5 September.

  **`content_type` has six values and none of them is text**: videos, photos,
  jobs, live_videos, documents, collaborative_articles. The connector never
  sends it.

  **A credential probe is free.** A key past authentication with no query gets
  400 "Missing required parameter(s): query" at `credits_used: 0` and an
  unchanged balance; a bad key gets 401 "Invalid API key format. Keys start
  with 'sc_'." That matters more here than on X — a probe billed at five
  credits would charge a person for typing their key correctly.

  **A search that matches nothing is billed in full, and is not empty.**
  `intentwatch-no-such-phrase-9a3f7c21` returned ten unrelated posts,
  `total: 98`, for five credits. X refunds the same call and returns nothing.
  So this connector has no empty-page signal, and a vague query is full-price
  noise rather than free silence.

  **The provider caches, and a cached answer is free.** The repeat call came
  back `cached: true` in 403 ms for zero credits. Recorded as the zero it was;
  nothing counts on it, because the window is undocumented.

  Total: 30 credits, 96 down to 46 across both runs.

- 2026-09-05T22:38+08:00 — The word limit, measured rather than assumed.
  `end to end tests keep breaking` — six words, the phrase that returned anime
  and Bitcoin on X — returned ten LinkedIn posts, **eight of them on topic**:
  treating flaky tests as a signal rather than an annoyance, a suite glued to
  timing assumptions, one hundred percent coverage that still shipped a
  production bug. The two-word `flaky tests` returned ten that were all on
  topic. Both work, so `maxQueryWords` is 8 — the generator's own ceiling, not
  a narrower one. A long-form post has somewhere for a phrase to appear.

  That is precision, and it is only precision. Nothing here measures volume,
  and `total` is the provider's own number rather than one we counted.

- 2026-09-05T22:40+08:00 — Two design decisions, both forced by measurement.

  **The billable unit is the credit, not the request.** `x.ts` says request
  because one X request is one credit. Here it is five. A connector reporting
  one request against a per-credit price would tell the budget guard the poll
  cost a fifth of the bill, and the guard would let a monitor spend five times
  its cap.

  **X's "stop paging when the page is older than `since`" rule is deliberately
  absent.** That rule is sound on a newest-first list. This endpoint sorts by
  relevance: a captured page ran 22 August, 22 August, 4 September, 31 August,
  15 August. Copying it would throw away a fresh post sitting behind an old
  one. `linkedin.test.ts` asserts the page is *not* sorted by date, so the rule
  cannot be reintroduced by someone who assumes it is.

- 2026-09-05T22:47+08:00 — The suite passes: 71 tests across the two SocialCrawl
  connectors, and the X connector's own tests unchanged by the shared client.
  Five expected values in `apps/api/src/monitors.test.ts` moved, all the same
  behaviour: the query map carries one key per platform in the build, so a
  third platform adds an empty list. That is the behaviour US-027 designed and
  the change the ticket asked for.

  `pnpm test` as a whole is red on this machine for an unrelated reason, and it
  was before this ticket. Postgres `max_connections` is 100; the suite creates a
  database per file and runs the files in parallel, so one or two fail with
  "sorry, too many clients already" — sometimes surfacing as a 500 from a route
  whose insert could not get a connection. Which file fails moves between runs,
  and every one of them passes alone. A stash of this branch failed the same
  way, so this ticket did not cause it, though adding a test file makes it
  likelier.

  **`pnpm vitest run --maxWorkers=3` passes all 866 tests in 55 files.** That is
  the measurement rather than the argument. Capping the workers, or pooling
  fewer connections per test database, is a chore ticket of its own.

- 2026-09-05T22:52+08:00 — Cost, said plainly because it belongs in front of
  anyone who starts one of these monitors. Five credits a call and ten posts a
  call is **$0.0041 a post**: ten times an X post and twenty-seven times a
  Bright Data Reddit record. One query, polled hourly, at the two pages a poll
  allows, is about **$58 a month** before a single model call. docs/costs.md and
  STACK.md carry the number and the reason.
\n
- 2026-09-05T23:04+08:00 — The suite runs green at full parallelism now, and
  the fix was not to cap the workers.

  The connection exhaustion was never about worker count. `pg` and `pg-boss`
  each default to **ten** connections per pool, a test file holds one of each,
  and fifty-five files in parallel ask a server configured for one hundred.
  Capping workers to three worked by accident — fewer files, fewer pools — and
  cost the same 89 seconds, because the suite is bound by per-file migrations
  rather than by CPU.

  `db/client.ts` now reads `DATABASE_POOL_SIZE` and `vitest.config.ts` sets it
  to 3, the way that file already blanks the model keys: a property of the
  setup rather than of the code each test happens to call. Both `PgBoss` call
  sites take it too, because capping only the Drizzle pool leaves half the
  connections uncapped. Nothing sets it in production, where ten is right.

  **Four consecutive full-parallelism runs: 866 passed, 84.9 to 90.5 seconds.**
  Three is the pool size rather than one, because a file may hold two databases
  and a pool of one deadlocks a caller that holds a connection while asking for
  another.

- 2026-09-05T23:12+08:00 — **One live poll ran through the worker and stored
  real LinkedIn posts.** `live:linkedin-poll` is committed beside
  `live:provider-switch`, and it drives the real four steps with a queue that
  runs the next step instead of enqueuing it.

  The numbers. Two pages, **20 posts, 10 credits, 3.6 seconds** from trigger to
  stored. `api_usage` holds one row for the pair — platform `linkedin`,
  provider `socialcrawl`, 10 units, **81,180 micro-dollars** — and the
  arithmetic is the connector's own price rather than an assumption: 10 ×
  8,118. The unit is the credit, which is the decision this ticket made, and
  the row is what it looks like when it is right.

  **The pre-filter dropped nothing**, again. All 20 posts came back from a
  search for those words, so all 20 bought a model call. That is the third time
  this has been measured — US-022 on a subreddit, US-006 on X, here on LinkedIn
  — and it is the same fact each time: there is no cheap stage between a search
  and the bill when the search already matched the words.

  **Five matches, 69 down to 54, against a `min_score` of 50**, and they read
  like leads. The top one is a direct question: "How Do You Handle Flaky
  AI-Generated Tests in CI/CD Pipelines?" Below it, someone triaging three
  flaky Playwright tests in CI where checkout failures block releases and
  asking how others prioritise; someone who spent a week debugging their own
  test rather than a bug; and two people writing about timing assumptions and
  Selenium flakiness. The reasons name the words in the post rather than
  restating the score.

  The honest read is that the last two are content marketing about flaky tests
  rather than people asking for help, and the classifier scored them 55 and 54
  — inside the band US-012's five verdicts already said is untrustworthy. The
  gap between the direct question at 69 and the article promotion at 54 is
  fifteen points, which is narrower than it should be. LinkedIn is a platform
  where people post to be seen, so **the noise here is expertise-signalling
  rather than the off-topic noise Reddit keyword search produced.** That is a
  different problem and the pre-filter cannot see it.

  19 classifier calls scored, 21,938 input and 4,276 output tokens across
  everything, and 2 embedding calls covering all 20 posts. Both spends are
  recorded null: `gpt-5.6-luna` has no price in `provider.ts` and no embedding
  price is set. Null means "we cannot say", which is the rule.

- 2026-09-05T23:14+08:00 — **A real model timeout happened, and it is the first
  one.** One of twenty answers came back as "The operation was aborted due to
  timeout". It was recorded as `failed`, no match was written, the post kept
  its place, and the other nineteen finished. Until today a timeout was
  simulated in this repository. So for the classifier the malformed answer
  (US-006) and the timeout (here) are both proven handled, and a real rate
  limit is the one that is left.

  It also found a rough edge in the instrument rather than in the product. The
  classify step throws when it could not score every post, so `pg-boss` retries
  the missed ones — right in the worker, and wrong in a script, which died
  after the posts were already stored and billed. Re-running to read the
  matches would have paid $0.081 twice. The script now catches it and reports
  it.

  Still unproven for this connector: a real rate limit, a real outage, and a
  second poll proving deduplication on LinkedIn. The monitor is left paused, so
  it spends nothing further.

- 2026-09-05T23:22+08:00 — Closed. Eight boxes, all true. LinkedIn is the third
  platform, one live poll has run through the worker, and the two things this
  ticket cannot claim are written down rather than left implied: the volume
  question is untouched, and the noise on this platform is on-topic
  self-promotion that no cheap stage can filter.
