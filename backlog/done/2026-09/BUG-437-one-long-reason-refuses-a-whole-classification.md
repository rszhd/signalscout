---
id: BUG-437
title: One reason over 160 characters refuses a whole classification
type: bug
priority: p2
created: 2026-09-29T21:29+08:00
parent:
area: classifier
resolution: shipped
---

## Context

`classificationSchema` in `engine/src/ai/classification.ts` allows each
reason 12 to 160 characters (`longestReason`). When the model writes one
reason longer than that, the whole answer fails the schema and
`generateStructured` returns `rejected`: "No object generated: response did
not match schema … reasons.3: Too big". The scores in the same answer are
thrown away with it, and the post has no score.

The classify step then treats the post as failed. It is tried again, each try
is a new paid call, and after `maxClassificationAttempts` (3) the post is
dropped. A post that could have been a match never becomes one, and nobody
sees why unless they read `model_calls`.

Seen live on 2026-09-29 in a private experiment on these packages (US-434),
with `deepseek-flash`: 3 of about 75 posts that reached the classifier in
two scans were refused this way, 1 of 60 and 2 of 15.

This is BUG-383's shape in another schema: one bad line refuses the whole
answer. The fix keeps the answer. Two ways, and the ticket decides between
them:

- **Cut a long reason** to `longestReason` before the schema checks it, and
  keep the scores. The inbox shows a reason that ends early.
- **Drop only the long reason**, and keep the answer while at least
  `minimumReasons` remain.

Either way a reason is never the reason a score is lost. A reason too short,
or an answer with too few reasons, is still refused, because then the model
did not say why.

## Acceptance

- [x] An answer with one reason over 160 characters is stored with its
      scores, and the post can become a match.
- [x] The reason shown is at most 160 characters.
- [x] An answer with fewer than `minimumReasons` usable reasons is still
      refused.
- [x] The prompt does not change, so the scoring captures are not needed;
      if the fix changes a score or the prompt, `docs/instruments.md`'s
      scoring loop runs before release.
- [x] The suite passes.

## Notes

- `classificationSchema`, `reason`, `longestReason`, `minimumReasons` in
  `packages/engine/src/ai/classification.ts`; the retry rule is
  `maxClassificationAttempts` in `packages/pipeline/src/worker/classify.ts`.
- The classification schema is a correctness-critical surface: the test is
  written first.

## Log

- 2026-09-29T21:29+08:00 — Written from US-434's scans of invoiceninja.com and plausible.io.
- 2026-09-29T22:30+08:00 — Fixed by cutting, the first of the two ways: `reason` is a
  `z.preprocess` that cuts a string over `longestReason` to 159 characters
  and "…" before the same `min`/`max` check. `z.toJSONSchema` of
  `classificationSchema` is byte for byte what it was, so a model that is sent
  the schema, and one that reads it in the prompt, see the same text, and the
  scoring captures are not needed. Tests first: the schema keeps an answer
  with a long reason and its scores; the JSON schema still says 12 to 160; the
  classify step turns such an answer into a match with one `scored` call (red
  without the fix). Two more live scans on 2026-09-29 had 6 more refusals of
  this shape.
- 2026-09-30T10:11+08:00 — Shipped in 0.19.0 (tag v0.19.0, merge commit f94b846).
