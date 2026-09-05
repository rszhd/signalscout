---
id: US-022
title: A real match reaches the inbox
type: chore
priority: p1
created: 2026-09-05T13:52+08:00
parent:
area:
resolution:
---

## Context

Every part of the path has been proven alone. The path has never been run.

The Reddit connector collected forty-nine real posts on 2026-09-05. The
classifier answered a real model on the same day, for four worked examples. The
inbox rendered seeded rows in 12.7 ms. A verdict was given against a seeded
row. Each of those is a separate proof, and none of them touches the next one.

So the product's central claim is untested: a person creates a monitor, the
worker finds a post, a model scores it, and the person reads a reason worth
acting on. The live run stored posts and never scored them. The inbox has never
shown a match a model produced.

Two smaller gaps sit inside the same run. US-010 changed the classifier's
system prompt after the fixtures were captured, so `ai/examples.test.ts`
replays answers older than the prompt they are replayed against. And US-010
added the query generator, which no model has ever answered.

The run also produces the only evidence that can correct our cost arithmetic.
`docs/costs.md` lists five ways the estimate is wrong and expects a sixth. A
poll whose `api_usage` rows are compared against Bright Data's own figure turns
one of those from a warning into a measurement.

This ticket is a run, not a feature. The code to change is whatever the run
breaks.

## Acceptance

- [x] `capture:queries` has run against a live model and the queries are
      recorded
- [ ] The recorded queries were read, not trusted: no subreddit that does not
      exist, and not one query written eight ways
- [x] `capture:classifier` has run against the prompt US-010 shipped, so
      `ai/examples.test.ts` no longer replays answers older than the prompt
- [x] A monitor created through the form, not through an `INSERT`, has polled
      Reddit live and stored posts
- [x] `filter_drops` holds the similarity of every post the pre-filter refused
      in that run
- [x] At least one stored post was scored by a live model and written as a
      match
- [x] That match was read on the inbox screen, and the reason shown was written
      by the model
- [x] A verdict was given on that match through the screen
- [ ] The run's `api_usage` rows are compared against the provider's own
      figure, and the difference is recorded in the Log
- [x] Every claim in AGENTS.md that this run settles is rewritten, whichever way
      it turns out

## Notes

- Depends on nothing that is not built. The Reddit connector reads
  `REDDIT_API_KEY` from the environment, which is how the 2026-09-05 collection
  ran. US-010's open acceptance box is a connection-testing screen, and it does
  not block a run from the command line.
- The commands, in order:

      pnpm --filter @intentwatch/core capture:queries
      pnpm --filter @intentwatch/core capture:classifier

  Then `pnpm dev`, the monitor form, and the inbox.
- What the run costs. Bright Data bills one record at $0.0015, so a fifty-record
  collection is $0.075, and less if the account is inside the 5,000-record
  monthly allowance that `docs/costs.md` says we do not model. The two captures
  are five short model calls. Classifying what survives the pre-filter is one
  short call per post. Budget under $0.25 and set the monitor's cap far below
  that, so US-013's guard is the thing that stops an accident.
- Set the monitor's poll interval high. The 2026-09-05 run measured what the
  60-second floor costs: a collection every minute, 9 to 11 records billed each
  time, and no posts, because everything found was older than the last poll.
- What this run cannot prove. One monitor is not a distribution. The scores it
  produces say the path works, not that the threshold is right. The
  `filter_drops` rows it writes are the instrument for that, and reading them is
  a later ticket.
- Three provider failures stay unproven either way: an expired snapshot, a
  collection the provider reports as failed, and a rate limit. Do not claim them.

## Log

- 2026-09-05T13:52+08:00 — Written after a review of docs/testing.md. The review
  argued that proving another low-risk assertion is sensitive costs more than it
  returns while the product's own path has never run. The path had no ticket.

- 2026-09-05T13:53+08:00 — `capture:queries` ran. One call to
  openai/gpt-5.6-luna, recorded in `ai/fixtures/query-plan.json`. Seven queries
  and five subreddits. The queries are seven different angles, not one written
  seven ways: three state the problem, one asks a question, two name a
  competitor, one names the missing role. The five subreddit names could not be
  checked. Reddit answers 403 to an unauthenticated request from this machine
  and a web search found nothing, so only `softwaretesting` is proven, by the
  poll below collecting fifty posts from it. That half of the box stays open.
- 2026-09-05T13:55+08:00 — `capture:classifier` ran against the prompt US-010
  shipped. Four calls. The scores are 7, 64, 86 and 96, against PLAN.md's
  intents of 3, 50, 90 and 96. The order holds and the gap between the drop and
  the first match is 57 points. `ai/examples.test.ts` now replays answers
  written by the prompt it is replayed against.
- 2026-09-05T14:09+08:00 — The cost test ran live for one keyword, "end to end
  tests keep breaking". It took 2 minutes 45 seconds, billed 10 records for
  $0.015, kept 9 posts, and projected $10.80 to $54.00 a month at an hourly
  poll. The two earlier live tests in this database took 1 minute 41 seconds
  and 8 minutes 8 seconds, so the form's "about two minutes" is the fastest
  case and not the normal one.
- 2026-09-05T14:10+08:00 — The samples are the finding. Bright Data's keyword
  discovery returned "failed both exams and don't know what to do" from
  r/AllFinraExams, "A never ending test" from r/islam and "Genuinely at my wits
  end" from r/labrats. It matched "test" and "end" as ordinary words. The 49
  posts the 2026-09-05 collection stored are the same kind, and so are the four
  matches already in the database. The monitor was changed to collect one
  subreddit, `softwaretesting`, and no keyword.
- 2026-09-05T14:15+08:00 — The run found a bug, and it is not in the connector.
  `PATCH /api/monitors/:id` parsed its body with `createBody.partial()`. A Zod
  field that is optional and defaulted is still filled in when it is absent, so
  an edit carrying one setting arrived carrying empty answers for everything
  else, and the route wrote them. The pre-filter form on the monitor list sends
  `preFilter` and nothing else, so moving the similarity slider erased the
  monitor's signals, its sources and its search plan, and bumped
  `monitors.version`, which orphans every verdict already collected. Two tests
  were written first and both went red. `updateBody` now re-declares the four
  list fields without their defaults, so absent means absent.
- 2026-09-05T14:28+08:00 — The poll. One subreddit, 50 records, $0.075, and the
  snapshot took 8 minutes 40 seconds. Every post is on topic, which the keyword
  search never managed: "What actually gives you confidence before a production
  deploy?", "Need suggestions for switching to automation from manual testing",
  "When to do Manual testing and when to do Automation testing?".
- 2026-09-05T14:32+08:00 — The pre-filter dropped one post of fifty, at
  similarity 0.128. The model read the other 49 and wrote 20 matches, scoring
  30 to 71. The model half of the run is 49 classification calls (40,752 input
  and 10,227 output tokens), 2 embedding calls for 51 texts, and the one query
  generation. Every one is recorded as unpriced, because no price is configured
  for `gpt-5.6-luna`.
- 2026-09-05T14:35+08:00 — The last two boxes closed on the screen. The top
  match scored 71: a QA lead joining a fintech company with no automation, who
  asks what to prioritise from day one. Five verdicts were given through the
  inbox, all against version 1: good at 71 and 59, not relevant at 53, 52 and
  50. The verdicts do not follow the scores. The three refused posts are people
  asking how to learn automation, which is a career question and not a buyer.
  Five verdicts on one monitor is not a distribution, and the ticket does not
  claim one.
- 2026-09-05T14:36+08:00 — Two numbers this run measured that the design
  should answer. A `min_score` of 30 is too low for a subreddit: "Dev memes"
  scored 33 and reached the inbox, because inside a topical subreddit every
  post is somewhat relevant and the scores compress upward. At 50 the same poll
  leaves nine matches and all nine are real. And the pre-filter saved one post
  of fifty, because it was built for keyword noise; with subreddit discovery
  every collected post costs a model call, and that is the arithmetic a cost
  line has to show.
