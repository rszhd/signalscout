---
id: US-027
title: A query fits the platform it searches
type: feature
priority: p2
created: 2026-09-05T21:52+08:00
parent: US-010
area:
resolution: shipped
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

- [x] The generator is told which platform each query is for, and writes
      queries that fit it
- [x] An X query is short enough to match a real post; the prompt says so and
      the fixtures show it
- [x] A monitor watching two platforms gets a query set for each, and the
      monitor row keeps them apart
- [x] `capture:queries` records the plan for both platforms, so the fixtures
      are evidence about the prompt that ships
- [x] The cost test prices each platform's own queries, not one set priced
      twice
- [x] A monitor written before this change still polls, and its queries are not
      silently rewritten
- [x] The measurement that started this is repeated: the new X queries are run
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

- 2026-09-05T22:26+08:00 — Built. The rule lives on the platform, because "an X
  post is a few sentences" is a fact about X and not about SocialCrawl.
  `PlatformDescriptor.search` carries a ceiling and the sentence that explains
  it, and one number reaches every place a query is written or edited: the
  model's schema, the API body, and the form. Four words on X, eight on Reddit.
  The prompt gives the reason beside the number, because a model told only a
  limit talks itself out of it on the query it likes.

  `monitors.generated_queries` is now an object keyed by platform. The column
  was already `jsonb`, so nothing about the schema moved and migration 0021 is
  hand-written: it keys each row by the platforms its monitor watches and
  rewrites no query. It ran against the development database — six monitors,
  every query kept, no row left in the old shape. A monitor that names no
  platform keeps its array, and both worker steps read that shape too, so it
  still polls.

  The poll asks each platform with its own list, inside the loop over sources.
  The pre-filter builds one keyword rule per platform and checks a post against
  the queries that could have found it: checking an X post against a Reddit
  phrase would drop it for missing words nobody asked X for, and checking a
  Reddit post against a two-word X query would keep almost everything and send
  the bill to the model. The cost test prices each platform's own list, so a
  query is no longer priced twice for two platforms when only one would run it.

  The form asks for one list per platform, shows each platform's limit and its
  reason, and marks a query that is too long before the button is pressed.

  827 tests pass, with `pnpm lint`, `pnpm typecheck` and `pnpm build`. Four
  deliberate mutations were confirmed to turn the suite red: filtering with
  every platform's queries at once, polling with every platform's queries at
  once, raising X's ceiling to eight, and dropping the platform from the
  filter's rule. Expected values moved in five test files, and every one of
  them moved because the shape of the stored queries changed, which is what
  this ticket asked for.

- 2026-09-05T22:41+08:00 — Both instruments have run, and the ticket closes.

  `capture:queries` wrote a plan for both platforms with `openai/gpt-5.6-luna`,
  for 733 input and 540 output tokens. Every X query is four words or fewer and
  every Reddit query is eight or fewer, so the model obeyed a limit it was
  given with a reason. Two of the eight X queries are also in the Reddit list,
  which is not a fault: a short phrase that works on X works on Reddit too, and
  the lists are allowed to overlap where the words suit both.

  The first run of it was **rejected by the schema**, and the message said only
  "response did not match schema". That is a hole this ticket had to fill
  before it could see its own work: `call.ts` now carries the schema's own
  complaint into the error, truncated. The second run passed and the first
  cannot be attributed, so what is proven is that the guard refuses an answer
  the rules do not allow, and not which rule that answer broke.

  One cost note from the plan: the model wrote eight X queries, which is the
  ceiling. Eight queries at two pages each is up to sixteen credits a poll, so
  a person who keeps all eight and polls hourly is buying about 11,500 credits
  a month. The form's own cost test does that arithmetic before anything runs.

  Then the last box, live. `capture.mjs --only=generated` reads the first X
  query out of the plan — so it cannot quietly test a nicer query than the one
  that ships — and searched it at the provider. `UI changes break tests`
  returned **6 posts for 1 credit** in 5.6 seconds. Three are on topic: tests
  glued to a CSS class that break when a button is renamed, brittle selectors
  breaking when the UI changes, and teams struggling to keep tests alive. Three
  are not: a WireGuard panel, stacked diffs and a local model server.

  So the fix works, and the honest reading of the number is narrower than
  "solved". A generated four-word query finds real people describing this
  problem, at about half the page. It is also a thinner seam than the hand-
  written `flaky tests`, which returned twenty posts inside three days where
  this one returned six across six weeks. **Precision and volume are two
  measurements, and this ticket only moved the first.**
