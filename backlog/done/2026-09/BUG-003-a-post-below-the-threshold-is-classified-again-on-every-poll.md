---
id: BUG-003
title: A post below the threshold is classified again on every poll
type: bug
priority: p1
created: 2026-09-06T01:12+08:00
parent: US-009
area:
resolution: fixed
---

## Context

The classify step skips a post it has already paid for by asking whether the
post has a row in `matches` (`worker/classify.ts:93`). That question is not the
same as "has this post been scored". A post the model scored below the
monitor's `min_score` writes a `model_calls` row and no `matches` row, so
nothing that the skip reads records the work.

The collect step hands the filter every post a poll saw, not only the new ones
(`worker/collect.ts:520`). That is deliberate and correct: a post one monitor
stored has never been matched against a second monitor, so returning only the
inserted rows would drop it out of that monitor's pipeline for good.

The two together mean a poll pays to score the same post again every time the
provider returns it. Deduplication stops a second row. It does not stop a
second model call.

The development database measures it. Of 229 `(monitor, post)` pairs, 75 were
classified twice, and 72 of those 75 have no match row. A quarter of every
model call made in this project so far bought an answer it already had.

Two things make this worth a p1 now.

The provider returns the same page, so the waste grows with poll frequency
rather than with new content. US-026's ScrapeCreators run collected 47 posts
and stored none: at steady state an hourly poll re-scores most of a page every
hour, forever.

And the model price is no longer a rounding error beside the provider price. A
classification averages 802 input and 207 output tokens. On `gpt-5.6-luna`
($0.20 / $1.20 per million) that is $0.0004 a post; on `gpt-5.6-terra` ($2.00 /
$12.00) it is $0.0041. At the second price a monitor's model bill passes its
provider bill, and a quarter of it is this bug.

The skip must be keyed by `monitors.version`, not only by the pair. The version
counts edits to the four fields `ai/prompt.ts` puts in the system prompt, so a
post scored under version 1 has not been scored against version 2's question. A
skip that ignores the version would freeze a monitor's old answers in place
after its owner rewrote what it looks for.

## Acceptance

- [x] A post already scored for a monitor at the monitor's current version is
      not classified a second time
- [x] A post scored under an older `monitors.version` is classified again
- [x] A post scored for one monitor is still classified for a second monitor
- [x] A post whose classification failed is still retried, up to
      `maxClassificationAttempts`
- [x] A rename, an edited query or a moved threshold does not cause a re-score,
      because none of them moves the version
- [x] Polling the same page twice with no new content makes zero classification
      calls, asserted against real Postgres

## Notes

- `model_calls` carries no version today. The smallest fix is a
  `monitor_version` column on it, written by `ai/record.ts`, and a skip set
  built from `purpose = 'classification' AND outcome = 'scored' AND
  monitor_version = monitors.version`. `feedback.monitor_version` is the
  precedent for the name and the type.
- Next migration number is 0023.
- `filter_drops` already solved the same problem one stage earlier. Its
  `UNIQUE (monitor_id, post_id)` exists so that "the count of drops is a count
  of posts and not a count of polls". This ticket makes the classifier obey
  the same rule.
- The failure count at `classify.ts:97` is the other query that reads the pair.
  Decide whether a version change also resets a post's failed attempts. It
  probably should — a new prompt is a new question — but it is a second
  decision and it needs its own case.
- Unrelated and worth doing beside it: no model price is configured, so
  `estimated_cost_micros` is null on all 307 calls and `budget.ts:235` sums
  none of them. A monitor's cap currently watches the provider bill only. For
  Luna that is `AI_INPUT_PRICE_MICROS=200000` and
  `AI_OUTPUT_PRICE_MICROS=1200000`. Prices read from OpenRouter's model pages
  on 2026-09-06, not from OpenAI's own page, which returns 403 to us.

## Log

- 2026-09-06T01:12+08:00 — Found while pricing a proposal to replace the
  pre-filter's similarity stage with a cheap model call. The proposal was
  refused for a different reason — `filter_drops` holds 2 drops for 234 posts,
  so a gate in that slot has nothing to drop — but the cost question exposed
  this. Measured on the development database, not argued:

      (monitor, post) pairs        229
      classified once              154
      classified twice              75
      of those, with no match       72

  The three repeats that do have a match row are not explained yet. They may
  predate a match being written, or they may be a second path into the same
  step. Check before assuming the guard works for matched posts.

- 2026-09-06T01:52+08:00 — The three repeats that had a match row are explained,
  and they are this bug and not a second path. In each one the first call scored
  the post under the threshold and wrote no match, and the second call, three
  minutes later, scored it 51 to 53 against a `min_score` of 50 and wrote one.
  Same monitor, same version, no edit between them. So a post near the
  threshold does not get one answer: it gets an answer per poll, and it reaches
  the inbox on the poll that happens to round up. Paying twice is the cost of
  the bug. This is the other half, and it is worse — the inbox is not
  reproducible.

- 2026-09-06T02:05+08:00 — Fixed. `model_calls.monitor_version` (migration
  0023) records the version a call answered, and the skip is now
  `purpose = 'classification' AND outcome = 'scored' AND monitor_version =
  monitors.version`. A check constraint refuses a classification without a
  version, because a writer that forgets one pays twice in silence and nothing
  else would say so.

  Two consequences the ticket did not name.

  The ledger row and the match are now written in one transaction. The ledger
  is what says a post has been scored, so a match lost between the two writes
  would be a match nothing scores again. Before this change the same crash cost
  one more model call and recovered.

  A re-score under a new version now rewrites the match's scores instead of
  discarding them (`on conflict do update`), and does not notify a second time.
  Without it, acceptance box two spends money and changes nothing: the model is
  asked the new question and the answer is dropped on the old row. Reading,
  saving and verdicts are left alone — the row's history is the person's.

  The failure count carries the version too. A new prompt is a new question,
  and a post the model could not answer three times has not been asked this
  one. That was the ticket's open decision; it has its own case.

  Eight tests: six in `worker/classify.test.ts` and two in `db/schema.test.ts`.
  Three deliberate mutations of the fix were each caught: reading `matches`,
  dropping the version from the skip, and dropping the monitor from it. The
  first mutation also caught the end-to-end poll case only after that case was
  rewritten — its first version waited on the model-call row rather than on the
  notification, so it finished before the second poll started and passed
  against the bug. A poll test now asserts the second poll was billed, because
  "no model call" is also true of a poll that never ran.

  The migration backfills every existing classification with version 1.
  Versions only increase, so for a monitor still at version 1 that is exact,
  and for an edited one it forces one more score rather than claiming an answer
  the model never gave. On the development database it is exact everywhere: all
  8 monitors are at version 1, so the 307 backfilled rows cost nothing to
  re-score. Measured after migrating: 230 pairs, 77 classified twice — the
  waste this closes, and it stops growing now.

  The suite is 874 tests in 55 files and passes with `--maxWorkers=3`.

  Not done, and separate: no model price is configured, so
  `estimated_cost_micros` is null on all 307 calls and a monitor's cap still
  watches the provider bill only. That is a `.env` decision, not a code change.
