---
id: US-008
title: A cheap filter runs before the model
type: feature
priority: p2
created: 2026-09-04T22:49+08:00
parent:
area:
resolution: shipped
---

## Context

PLAN.md puts a cheap pre-filter between collection and the AI engine. Its job
is to keep the model bill low, which is the whole basis of the bring-your-own-
key promise: a user who is billed heavily for noise stops running the monitor.

Two stages, both inside Postgres:

1. **Keyword and subreddit match.** Free. Removes the obvious misses.
2. **Embedding similarity with `pgvector`.** The monitor description is
   embedded once. Each surviving post is embedded and compared. Everything
   below a threshold is dropped.

An embedding call costs roughly one hundredth of a classification call, so
stage two pays for itself whenever it drops more than a few percent.

The threshold is the risk. Set too high, it discards good leads before anyone
sees them, silently — and a silent false negative is worse than a noisy inbox,
because nobody can tell it happened. So the threshold is settable, it starts
permissive, and dropped posts are recorded with their score for a period, so
the setting can be judged against real data rather than intuition.

Note the order this sits in. On X, the money was already spent at fetch time.
The pre-filter saves the model bill, not the source bill. Query precision is
what saves the source bill, and that is [US-014](US-014-a-querys-cost-is-known-before-it-runs.md).

## Acceptance

- [x] Keyword and subreddit matching runs first and costs nothing
- [x] Monitor descriptions are embedded once and re-embedded when the monitor
      is edited
- [x] Surviving posts are embedded and compared with `pgvector` cosine distance
- [x] The threshold is settable per monitor and starts permissive
- [x] A dropped post is recorded with its similarity score, so the threshold
      can be reviewed against real data
- [x] A counter shows, per monitor, how many posts each stage dropped
- [x] Embedding failures do not drop a post; the post goes to the model
      instead, and the failure is logged
- [x] Turning the pre-filter off entirely is a setting, and the pipeline still
      works

## Notes

- Depends on [US-002](US-002-the-schema-holds-monitors-posts-matches-and-feedback.md)
  and [US-007](US-007-the-worker-runs-jobs-on-a-schedule.md).
- STACK.md, *The pre-filter*.
- An embedding failure must fail open, not closed. A dropped good lead is
  invisible; an extra model call is merely a cost.
- **The default provider cannot embed.** Anthropic publishes no embedding
  endpoint and it is this product's default. So the common install runs the
  keyword stage and sends everything it keeps to the model, until
  `AI_EMBEDDING_PROVIDER` and `AI_EMBEDDING_MODEL` name something else. That is
  the expensive direction and the safe one.
- **There is no price table for embedding models.** `provider.ts` carries chat
  prices we read from a provider's page; we have read no embedding price, so an
  embedding is recorded with a null cost until `AI_EMBEDDING_PRICE_MICROS` is
  set. docs/costs.md says so as the fifth way the estimate is wrong.
- No `pgvector` index was added, and the schema comment that said US-008 owned
  one is now wrong in the other direction. This stage compares a handful of
  post ids from one poll against one vector, which is a scan of those rows and
  not a search of the table. An index belongs to the first feature that asks
  "which posts are like this one", and nothing does yet.

## Log

- 2026-09-04T22:49+08:00 — Written from PLAN.md and STACK.md.
- 2026-09-05T12:31+08:00 — Built. Migration 0009 adds `filter_drops`, the monitor's
  `pre_filter_enabled`, `similarity_threshold` and `description_embedding`, and
  a third `model_calls` purpose. `worker/filter.ts` replaces the placeholder
  step. The monitor's vector is cached against the exact text that produced it,
  in `description_embedding_source`, so an edit is found by comparing strings
  rather than by a writer elsewhere remembering to clear a column. 517 tests
  pass.
- 2026-09-05T12:31+08:00 — What was decided and why. The keyword stage keeps a post that
  matches one word or comes from a named subreddit, and drops only what matches
  nothing at all; a stage demanding two words would have the same shape and a
  silent false-negative rate nobody measured. The similarity is computed by
  `pgvector` and not in TypeScript, because the distance operator is the part a
  fake would get wrong. One embedding call covers a batch, so the row carries
  the monitor and no post.
- 2026-09-05T12:31+08:00 — Nine deliberate mutations were each confirmed to turn the suite
  red: the keyword rule keeping everything, the threshold never dropping, both
  fail-open branches dropping instead, a stale monitor vector reused after an
  edit, the per-monitor switch ignored, an embedding recorded with no cost, the
  vector-width check removed, and drops never recorded.
- 2026-09-05T12:31+08:00 — One gap the mutations found. The step fails open in two places —
  the monitor's description, and the batch of posts — and the first test
  covered only one of them. A mutation that dropped every post at the second
  branch left the suite green. Two cases now, one per branch, and
  docs/testing.md says to count the branches of a swallow rather than the
  swallows.
- 2026-09-05T12:41+08:00 — Measured, live. `capture:embeddings` is the instrument
  docs/testing.md asks a measured constant to owe, and its first run embedded
  the example monitor and the five fake posts with OpenAI's
  `text-embedding-3-small`: 176 tokens, 4.4 seconds, two calls.

      0.5716  What are other small teams using?   (PLAN.md intent 96)
      0.5325  Tests break on every UI change      (PLAN.md intent 50)
      0.2972  Is there something easier?          (PLAN.md intent 90)
      0.2636  Playwright is awesome               (PLAN.md intent 3)
      0.0873  My starter died                     (sourdough, unrelated)

  The default threshold of 0.15 sits inside the 0.1763 gap between the lowest
  on-topic post and the unrelated one, with room on both sides.
  `ai/similarity.test.ts` replays the recorded numbers and goes red if the
  threshold leaves that gap — confirmed at 0.35 and at 0.05.

  Read the order rather than the pass. Similarity is topic and not intent:
  "Playwright is awesome" scores 0.26 and PLAN.md scores its intent at 3, while
  "Is there something easier?" at intent 90 scores 0.30. The pre-filter cannot
  tell those two apart and is not meant to. It keeps the sourdough out of the
  model's bill; the classifier does the rest, at a hundred times the price.

  The fixture records the similarities, not the vectors. Six vectors of 1,536
  floats would add about a quarter of a megabyte to re-prove arithmetic
  `pgvector` already does.
- 2026-09-05T12:41+08:00 — What is still unproven. The embedder's failure paths: a real
  rate limit, a real timeout and a real refusal have only been simulated. The
  threshold is measured against five posts and one monitor, which is a gap and
  not a distribution — the `filter_drops` rows are what move it next. And
  nothing measures what the stage saves, because that needs a month of real
  posts through a real model.
