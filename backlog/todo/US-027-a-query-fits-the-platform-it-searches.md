---
id: US-027
title: A query fits the platform it searches
type: feature
priority: p2
created: 2026-09-05T21:52+08:00
parent: US-010
area:
resolution:
---

## Context

The query generator writes one set of search strings and every platform is
given the same set. US-006 measured what that costs on X, and the answer is
that the queries do not work there at all.

**The measurement.** `end to end tests keep breaking` is a phrase the generator
wrote for PLAN.md's example monitor. Sent to X unquoted, it returned posts
about anime, Bitcoin and a CIA visit to Moscow, spread over three weeks: the
provider matched the words loosely and ranked what it found. Sent quoted, so
that the exact phrase must appear, it matched nothing at all — twice, on
separate runs. The two-word `flaky tests` returned twenty posts, every one on
topic and all inside three days.

So on X a generated query is either too loose to be useful or too exact to
match. Neither failure is visible from our side: both answers are a normal 200,
one with junk in it and one empty.

**Why the platform changes the answer.** A Reddit post has a title and a body
and often several paragraphs, so a six-word phrase can appear in it. An X post
is a few sentences. The longer the phrase, the smaller the chance that any real
post contains it, and the more words there are for a loose matcher to match
separately.

**Why this is not a connector change.** `sources/providers/socialcrawl/x.ts`
passes a monitor's words through unchanged, and that is right: a connector that
edited a person's query would hide the problem rather than fix it, and the next
platform would need its own edit in the same place. The generator is where a
query is written, and it is where a query should be written *for* somewhere.

**Cost follows from this too.** On X a search is billed per request, so a query
that matches nothing costs nothing — the waste is not money, it is a monitor
that finds nothing and says nothing about why. On Reddit through Bright Data
the same loose matching is billed per record, and US-022 already measured that:
the same noisy keyword cost $0.075 and produced four matches that were all
junk.

## Acceptance

- [ ] The generator is told which platform each query is for, and writes
      queries that fit it
- [ ] An X query is short enough to match a real post; the prompt says so and
      the fixtures show it
- [ ] A monitor watching two platforms gets a query set for each, and the
      monitor row keeps them apart
- [ ] `capture:queries` records the plan for both platforms, so the fixtures
      are evidence about the prompt that ships
- [ ] The cost test prices each platform's own queries, not one set priced
      twice
- [ ] A monitor written before this change still polls, and its queries are not
      silently rewritten
- [ ] The measurement that started this is repeated: the new X queries are run
      against the live provider once, and the Log holds what came back

## Notes

- Found by [US-006](../doing/US-006-x-returns-candidate-posts-and-says-what-it-spent.md),
  which built the X connector and measured the failure. Its Log holds the
  numbers.
- `packages/core/src/ai/queries.ts` and `ai/prompt.ts` are where a query is
  written. `ai/fixtures/query-plan.json` is the current plan, and it is Reddit's
  by accident rather than by decision.
- The `monitors.version` rule is easy to break here. It counts edits to the
  four fields the classifier's system prompt holds. An edited query must not
  move it, so a change that stores queries per platform must not touch that
  count.
- STACK.md, *Query precision is a cost lever*.
- Related: US-022 measured the same lesson on Reddit — keyword discovery
  returns noise and channel discovery does not.

## Log

- 2026-09-05T21:52+08:00 — Written from US-006's live capture against
  SocialCrawl. Three runs: the long phrase unquoted returned unrelated posts
  across three weeks, the same phrase quoted returned nothing twice, and a
  two-word query returned twenty posts that were all on topic.
