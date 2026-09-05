---
id: US-030
title: A cheap model decides which comments the good model reads
type: feature
priority: p2
created: 2026-09-06T01:32+08:00
parent: US-009
area:
resolution:
---

## Context

US-020 will collect Reddit comments. A subreddit poll returns about 23 posts
and those posts hold about 280 comments. Every one of them would reach the
classifier. This ticket puts a cheap model in front of it.

**The reason is not only price.** An embedding measures topic. Under a relevant
post, the asker and the twenty experts answering are equally on topic, so no
embedding threshold separates them. US-028 measured that failure on LinkedIn:
articles written to be seen scored fifteen points below a real question. A
small model can read "what did you end up using?" and tell it from "we use
Playwright, here is why". That is a job no cheaper stage in the pipeline can
do.

**What the price actually is.** `ai/fixtures/manifest.json` holds four real
calls: a classification is 680 input and 95 output tokens. Against the table in
`ai/provider.ts`:

| Model | One classification | 280 comments |
|---|---|---|
| Haiku 4.5 | $0.0012 | $0.32 |
| Sonnet 5 | $0.0023 | $0.65 |
| Opus 5 | $0.0058 | $1.62 |

A triage stage on Haiku that keeps a fifth for full scoring lands near $0.26
against $0.65. That is about half, not an order of magnitude: Haiku is 2x
cheaper than Sonnet, where an embedding is about 100x cheaper. **Most of the
saving comes from the output, not the model.** Output is priced five times
input, so a triage answer of one enum instead of five scores and four reasons
is where the money is.

Say the smaller number in the ticket. A cascade sold as an order of magnitude
is a cascade someone will later tune too hard.

**The failure to design against is a silent drop.** This stage decides what the
good model never sees. `db/schema.ts` says it twice already: a noisy inbox is
visible and a false negative is not. So the stage fails open, and every drop is
recorded.

## Acceptance

- [ ] A triage stage runs before classification and returns one value from
      three — `no`, `maybe`, `yes` — and no reasons
- [ ] Only `no` drops. A timeout, a refusal, a malformed answer or a rate limit
      passes the item to the classifier
- [ ] Every drop is written with the item id, so a person can read what was
      dropped and judge the stage
- [ ] The triage model is configured on its own and falls back to the
      classifier's provider, model, key and base URL, so a deployment that sets
      nothing keeps one stage and one bill
- [ ] `triage` is added to `modelCallPurposes`, and a triage call is recorded
      and priced like every other call
- [ ] US-013's budget guard counts triage calls, and a test proves a monitor
      cannot spend past its cap through this stage
- [ ] The fixtures the tests replay are captured from a real model through a
      script named in `package.json`, never written by hand
- [ ] The Log records the measured keep rate and the measured cost of one poll,
      against the same poll with the stage off
- [ ] Whether the embedding stage still runs on a comment follows
      [US-029](US-029-a-measurement-says-which-pre-filter-fits-a-comment.md)'s
      answer, and the Log names which it was

## Notes

- Depends on [US-029](US-029-a-measurement-says-which-pre-filter-fits-a-comment.md),
  which decides whether this is the second paid stage or the only one.
- Related to [US-020](US-020-a-monitor-can-include-reddit-comments.md), which
  is what makes the volume real. The stage is useful on posts too, but posts
  arrive from a search that already matched the words, so the saving there is
  small.
- The configuration precedent is in `ai/config.ts`: `EmbeddingConfig` is a
  second model block that falls back to the classifier's. Copy that shape
  rather than inventing one.
- A triage prompt is not the classifier's prompt with fewer fields. It asks one
  question. Write it as its own file so the classifier's prompt is not weakened
  to serve two callers.
- `modelCallPurposes` exists so a bring-your-own-keys product can answer "what
  was my key spent on". A third stage that does not appear on that bill makes
  the question unanswerable.
- Two models means two failure paths per item. `ai/call.ts` has three outcomes;
  each of them must be exercised on the triage path as well.

## Log

- 2026-09-06T01:32+08:00 — Written. The owner proposed a two-level classifier
  for cost. The measurement says the saving is about half, and the stronger
  reason is that no existing stage can separate a person asking from a person
  answering.
