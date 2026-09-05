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

- [ ] `capture:queries` has run against a live model and the queries are
      recorded
- [ ] The recorded queries were read, not trusted: no subreddit that does not
      exist, and not one query written eight ways
- [ ] `capture:classifier` has run against the prompt US-010 shipped, so
      `ai/examples.test.ts` no longer replays answers older than the prompt
- [ ] A monitor created through the form, not through an `INSERT`, has polled
      Reddit live and stored posts
- [ ] `filter_drops` holds the similarity of every post the pre-filter refused
      in that run
- [ ] At least one stored post was scored by a live model and written as a
      match
- [ ] That match was read on the inbox screen, and the reason shown was written
      by the model
- [ ] A verdict was given on that match through the screen
- [ ] The run's `api_usage` rows are compared against the provider's own
      figure, and the difference is recorded in the Log
- [ ] Every claim in AGENTS.md that this run settles is rewritten, whichever way
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
