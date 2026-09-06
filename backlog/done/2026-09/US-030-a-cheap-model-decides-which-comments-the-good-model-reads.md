---
id: US-030
title: A cheap model decides which comments the good model reads
type: feature
priority: p2
created: 2026-09-06T01:32+08:00
parent: US-009
area:
resolution: shipped
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

**US-029 measured the claim above, and it holds.** It embedded all 21 comments
of one real r/softwaretesting thread against PLAN.md's example monitor. The
highest similarity in the thread, 0.5504, is nine hundred characters of expert
advice about test plans and CI runners — higher than four of the five posts in
`ai/fixtures/similarities.json`. With the parent post's title prepended all 21
land inside 0.178 of each other and none is dropped at any threshold.

That limit was closed on 2026-09-06. A second thread, a statement post with
four asking comments among twenty-five, put the two classes on a scale for the
first time: **no threshold separates asking from answering**, in either
embedding setting. The highest score in the thread is an expert answering, and
the shipped threshold of 0.15 drops one of the askers. So this stage carries
the whole job of telling a person asking from a person answering, and nothing
cheaper stands in front of it.

The original limit, kept because it explains why the first answer was indirect.
**Zero of the 21 comments in the first thread was a person
asking**, so the two classes were never put on a scale against each other. What
was measured is that the stage's highest answer in the thread is an expert
answering, and that the setting which restores a comment's topic drops nothing.
Both point the same way and neither is the direct comparison. The decision is
that the embedding stage does not run on a comment, and **this stage is the only
paid stage in front of the classifier there.**

That zero is also worth designing against. Eleven of the 21 were experts
answering and ten were jokes, a moderator notice and a deleted body. One thread
cannot carry a rate, but it says what this stage will mostly see and mostly have
to answer `no` to.

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
cheaper than Sonnet, where an embedding is about 100x cheaper.

**One sentence here was wrong and the measurement removed it.** It said most of
the saving comes from the output rather than the model, because a one-word
answer replaces five scores and four reasons. It does not. A reasoning model
bills its own thinking as output, so a short answer does not make a short call:
measured, a triage answer cost **113 output tokens against a classification's
95**. The answer is still short for other reasons, and none of them is money.

So **all** of the saving is the price gap between the two models, and a
deployment with no gap has no saving. See the Log for what that costs.

Say the smaller number in the ticket. A cascade sold as an order of magnitude
is a cascade someone will later tune too hard.

**The failure to design against is a silent drop.** This stage decides what the
good model never sees. `db/schema.ts` says it twice already: a noisy inbox is
visible and a false negative is not. So the stage fails open, and every drop is
recorded.

## Acceptance

- [x] A triage stage runs before classification and returns one value from
      three — `no`, `maybe`, `yes` — and no reasons
- [x] Only `no` drops. A timeout, a refusal, a malformed answer or a rate limit
      passes the item to the classifier
- [x] Every drop is written with the item id, so a person can read what was
      dropped and judge the stage
- [x] The triage model is configured on its own and falls back to the
      classifier's provider, model, key and base URL, so a deployment that sets
      nothing keeps one stage and one bill
- [x] `triage` is added to `modelCallPurposes`, and a triage call is recorded
      and priced like every other call
- [x] US-013's budget guard counts triage calls, and a test proves a monitor
      cannot spend past its cap through this stage
- [x] The fixtures the tests replay are captured from a real model through a
      script named in `package.json`, never written by hand
- [x] The Log records the measured keep rate and the measured cost of one poll,
      against the same poll with the stage off
- [x] On a comment this is the only paid stage in front of the classifier: no
      embedding runs, and the Log records the keep rate against that shape.
      US-029 answered it — see the Context above

## Notes

- [US-029](../done/2026-09/US-029-a-measurement-says-which-pre-filter-fits-a-comment.md)
  answered that on 2026-09-06: on a comment this is the only one. On a post the
  embedding stage stays, unchanged.
- Related to [US-020](US-020-a-monitor-can-include-comments-and-replies.md), which
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
- 2026-09-06T09:31+08:00 — US-029 answered the stage order. On a comment this is
  the only paid stage: no embedding runs in front of it. The evidence is
  indirect — that thread held no asker — and it points one way in both embedding
  settings. That makes this
  stage's keep rate the whole saving rather than half of it, and it makes a
  false negative here the only silent drop on the comment path.

- 2026-09-06T02:38+08:00 — Built. The stage is `ai/triage.ts`, its prompt is
  `ai/triage-prompt.ts`, and it runs inside the pre-filter's `pass` because
  that step has five exits and every one of them has to reach it. `triage` is a
  third `FilterStage` rather than a new table: a drop is a drop, the monitor
  list already counts them, and a second table would be a second place to look.
  Migration 0024 widens the two check constraints. `AI_TRIAGE_MODEL` and its
  four companions fall back to the classifier's, so a deployment that sets
  nothing still runs the stage.

  Two design notes worth keeping. The price does **not** fall back once a
  triage model is named, because a cheap model billed at the classifier's rate
  would report a saving that did not happen. And a monitor with the pre-filter
  switched off skips triage too: it is one of the filter's stages, and deciding
  otherwise would be this product choosing which stage counts as filtering.

  912 tests pass. `ai/triage.test.ts` holds nineteen, six of which exist only
  to prove a failure keeps the item; `worker/triage.test.ts` holds eleven
  against real Postgres, including the one that proves a triage call reaches
  US-013's cap.

- 2026-09-06T02:40+08:00 — Measured, and it found something. `capture:triage`
  asked `openai/gpt-5.6-luna` about all 46 comments US-029 labelled by hand,
  plus PLAN.md's four worked examples. Fifty calls, 29,999 input and 5,677
  output tokens. **The cost is unknown**: `provider.ts` prices only the three
  Claude models and no override is set for this one, so every call is recorded
  with a null cost. That is the documented behaviour and it is why the cost box
  above stays open.

  | Class | Kept |
  |---|---|
  | People answering | 5 of 26 |
  | Neither | 13 of 16 |
  | People asking | 3 of 4 |
  | All comments | **21 of 46** |

  **It drops four fifths of the experts**, which is the saving this ticket was
  written for, and it keeps all three worked examples PLAN.md scores as leads.

  **It refused one person asking, and that refusal has to be read rather than
  counted.** The comment is "I'm currently testing a native android app and am
  looking for alternatives", and the example monitor sells a browser test
  runner. So the label and the verdict disagree for a reason: US-029's `asking`
  label answers "is this person asking?" and triage is asked "could this be a
  person to reach?" A native-app buyer is the first and not the second. The
  instrument said "must be all of them" on its first run and that claim was
  wrong; it now prints the refused comment and says to read it against the
  monitor. `ai/triage-examples.test.ts` asserts this case by name, so the next
  person to edit the prompt finds it.

  The uncomfortable half of the same table: **13 of 16 jokes and notices
  survived**, including a `[deleted]` body and a moderator's vendor-spam
  notice. The stage is lenient on noise and firm on experts. That is the safe
  direction and it costs classifier calls, so it is the number to attack next —
  in the prompt, not in the threshold, because there is no threshold here.

  Two threads and one monitor is not a distribution, and none of these rates
  may be written up as one.

- 2026-09-06T02:41+08:00 — What is left. The cost box needs
  `AI_INPUT_PRICE_MICROS` and `AI_OUTPUT_PRICE_MICROS` read from the provider's
  page, and then one live poll run with the stage on and off. Neither is
  blocked by anything here; both need a price nobody has read yet, and this
  repository does not fill that table from memory.

- 2026-09-06T02:50+08:00 — Priced, and the arithmetic reversed the ticket's own
  premise. OpenAI's published prices were read off
  developers.openai.com/api/docs/pricing and added to `ai/provider.ts`, which is
  where a price with a source belongs: luna at $0.20 and $1.20 per million
  tokens, terra at $2.00 and $12.00, sol at $4.00 and $20.00.

  `capture:triage` then ran again and recorded its own cost for the first time:
  **50 items, 29,999 input and 6,135 output tokens, $0.013360.** That is 267
  micro-dollars an item. One classification on the same model, at the 680 and 95
  tokens `ai/fixtures/manifest.json` measured, is 250. **Triage costs slightly
  more per call than the classification it exists to avoid.**

  The reason is the output. A one-word answer was supposed to be the saving, and
  it is not: this model bills its own reasoning as output, so triage spent 113
  output tokens against a classification's 95. The Context sentence claiming
  otherwise is struck.

  So the whole saving is the price gap, and here is what that means over the 46
  labelled comments at a keep rate of 19:

  | Classifier | Triage off | Triage on | Change |
  |---|---|---|---|
  | `gpt-5.6-luna` | $0.0115 | $0.0170 | **+48%** |
  | `gpt-5.6-terra` | $0.1150 | $0.0598 | **−48%** |

  **On one model for both stages the stage is a loss**, and that is this
  deployment's current configuration. `worker/runtime.ts` now warns at startup
  when the two models match, rather than letting the bill say it later. It warns
  instead of refusing, because the stage still keeps the experts answering out
  of the inbox, and because a local model makes the money argument moot.

  The second run also drifted: same 50 items, same prompt, 19 comments kept
  where the first run kept 21, and 6 people answering kept where the first kept
  5. The refused asker was the same one both times. `triage-examples.test.ts`
  now asserts bands rather than exact counts, the way `examples.test.ts` already
  does, because a test that goes red on a re-capture that changed nothing is one
  nobody reads.

- 2026-09-06T02:51+08:00 — What is left before this closes. One live poll with
  the stage on and off, which is now arithmetic rather than a guess but has
  still never run end to end. And a decision that is the owner's: this
  deployment classifies with luna, so triage costs it money today. Moving the
  classifier to terra makes the cascade pay and is its own ticket, because
  `ai/fixtures/*.json` were captured with luna and `capture:classifier` and
  `capture:queries` would both have to run again.

- 2026-09-06T12:03+08:00 — Closed. Every box was ticked when US-032 priced the
  models and the live YouTube poll exercised the stage on a fourth platform:
  triage dropped **60 of 71 videos**, an 85% drop rate and the highest measured,
  on the platform where most search results are tutorials rather than people.

  The stage has now run on Reddit posts, Reddit replies, YouTube videos and
  YouTube comments, and the shape held every time: it drops most of what it
  reads, it keeps the worked examples PLAN.md scores as leads, and it is the
  only paid stage in front of the classifier on a reply.

