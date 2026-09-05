---
id: US-029
title: A measurement says which pre-filter fits a comment
type: spike
priority: p2
created: 2026-09-06T01:32+08:00
parent: US-020
area:
resolution: shipped
---

## Context

US-020 will store Reddit comments. A comment is not a small post, and the
pre-filter US-008 built may not fit it. This ticket measures the question
rather than arguing it, because the answer changes what US-020 and US-030
build.

**The embedding stage has no obvious setting on a comment.** A post carries its
own topic. A comment borrows the topic from the post above it. That leaves two
settings and both are bad:

* **Embed the comment alone.** The stage filters, but a short comment carries
  no topic. "We hit this too — what did you end up using?" scores low and is
  dropped. That is the comment the feature exists to find.
* **Embed the parent title with the comment.** The context is restored, and
  every comment in the thread now inherits the parent's similarity. They all
  pass. The stage is then a cost with no drop.

**The stage cannot tell an asker from an answerer either.** Under a relevant
post most comments are experts answering with tools they like. They are on
topic. US-028 measured the same failure on LinkedIn — articles *about* flaky
tests scored fifteen points below a real question — and wrote down that a
pre-filter cannot catch it.

So the narrow question is: **two paid stages on a comment, or one.** US-030
adds a cheap model that can separate asking from answering. Whether the
embedding stage still earns its place in front of it is what this measures.

**The data is already on disk and costs nothing to fetch.**
`packages/core/src/sources/deletion-fixtures/scrapecreators-comments-canonical.json`
holds a real thread: one post and 21 real comment bodies, captured live during
the deletion work. Its subject is test automation, which is the subject of
PLAN.md's example monitor — the same monitor `capture:embeddings` already
embedded. So the baseline exists: on posts, four on-topic items scored 0.26 to
0.57 against that monitor and an off-topic one scored 0.09.

Twenty-one comments is not a distribution, and this ticket must not be written
up as one.

## Acceptance

- [x] The 21 comments in the captured thread are labelled by hand as asking or
      answering, and the labels are committed beside the fixture
- [x] Each comment is embedded three ways against PLAN.md's example monitor —
      alone, with the parent title prepended, and the parent title alone as the
      baseline — and the similarities are recorded
- [x] The similarities are committed, not the vectors, for the reason
      `capture:embeddings` already gives
- [x] The measurement runs from one script, named in `package.json` beside the
      other instruments, and the Log records what it cost
- [x] The Log says whether any threshold separates asking from answering, in
      either embedding mode, and names the threshold or says that none exists
- [x] The Log says what the same threshold does to the labelled comments at
      `defaultSimilarityThreshold`, which is 0.15 today
- [x] US-020 and US-030 are updated with the answer: the embedding stage runs
      on comments, or it does not

## Notes

- Depends on nothing. It reads a committed fixture.
- Blocks the stage-order decision in [US-020](../../todo/US-020-a-monitor-can-include-comments-and-replies.md)
  and [US-030](../../todo/US-030-a-cheap-model-decides-which-comments-the-good-model-reads.md).
- The instrument precedent is `pnpm --filter @intentwatch/core capture:embeddings`
  and `ai/similarity.test.ts`, which replays its numbers and goes red if the
  default threshold leaves the measured gap.
- About 1,300 tokens of embedding, well under a tenth of a cent. It is an
  instrument, not a test: no test spends money.
- The authors in the fixture are scrubbed. The comment bodies are real, which
  is the part being measured.

## Log

- 2026-09-06T01:32+08:00 — Written. The reason it is a spike and not part of
  US-020: the two embedding settings contradict each other, and no argument
  settles which one to ship. The fixture that answers it was already captured
  for the deletion work.

- 2026-09-06T09:12+08:00 — Labelled. The binary the acceptance asks for could
  not be applied honestly. Ten of the twenty-one are jokes about the post being
  written by a model, one moderator notice and one `[deleted]` body, and
  calling those `answering` would have measured a class that is not there. So
  `comment-labels.json` carries three values, `asking`, `answering` and
  `neither`, and a second field, `topical`, which asks only whether the comment
  is about test automation at all. That second field is the one the embedding
  stage can actually answer.

  **Zero of twenty-one are asking.** Eleven answer, ten are neither. That is
  not a gap in the labelling. Under a post that is itself a request for advice,
  nobody in the thread is the person we want. It is one thread and it cannot
  carry a rate, but it is the shape US-030 was written against.

- 2026-09-06T09:24+08:00 — Measured. `pnpm --filter @intentwatch/core
  capture:comment-filter`, two calls, 3,009 tokens in 3.5 seconds against
  `openai/text-embedding-3-small`. `estimatedCostMicros` is null, because no
  embedding price is configured and this repository does not fill that table
  from memory. Tokens are what the run can honestly report.

  The parent post title on its own scores **0.4187** against the monitor.

  | | Comment alone | Under the parent title |
  |---|---|---|
  | Range | 0.0771 to 0.5504 | 0.3715 to 0.5491 |
  | Spread | 0.473 | 0.178 |
  | Kept at 0.15 | 15 of 21 | 21 of 21 |
  | Asking against answering | no asking comment exists | no asking comment exists |
  | About testing against not | separated, gap 0.0103 | not separated |

  **Under the parent title the stage is a cost with no drop.** Every one of the
  twenty-one lands within 0.08 of the title's own 0.4187, and the highest
  off-topic comment, the moderator's vendor-spam notice at 0.4162, outscores
  eight comments that are about testing. No threshold separates them, at any
  tuning. That setting is refused.

- 2026-09-06T09:31+08:00 — Answered, and the answer is that the embedding stage
  does not run on a comment. Four reasons, in the order they carry weight.

  **It cannot do the job that matters.** The class it would have to separate is
  not the topical one. The highest similarity in the whole thread, alone, is
  **0.5504 on `p7s270n`** — nine hundred characters of expert advice about test
  plans and CI runners. That is higher than four of the five posts in
  `similarities.json`. A threshold tuned to keep a good comment keeps every
  expert answering under it.

  **Alone, it does separate topic, but not at a number we ship.** The gap is
  between 0.2202 and 0.2305, so it is **0.0103 wide** against the 0.18 measured
  on posts, and the shipped `defaultSimilarityThreshold` of 0.15 does not sit
  inside it. Shipping this would mean a second threshold, for comments only,
  tuned on one thread.

  **What 0.15 does today.** It drops six — four complaints and jokes about
  the post being written by a model, an aside about a job advertisement, and
  the `[deleted]` body — and keeps fifteen, three of which are
  off topic, the moderator notice among them at 0.2202. It drops no comment
  that is about testing. So the shipped threshold is safe here and saves 29% of
  the next stage's calls.

  **That saving is not worth its risk.** The comment US-029 was written to
  protect — the short "we hit this too, what did you end up using?" — is not in
  this thread, so nothing here shows what the stage does to it. US-030's rule
  is that a drop is invisible and a noisy inbox is not. Twenty-nine percent off
  the cheap stage does not buy an unmeasured silent drop.

  US-020 and US-030 are updated. `capture:comment-filter` is committed and
  re-runnable: a second thread, especially one holding a real asker, is what
  would move this answer.

- 2026-09-06T02:14+08:00 — Re-run against the second thread this Log asked for,
  and **the answer holds**. The gap was that no comment in the first thread was
  a person asking, because under a post that requests advice everybody
  underneath is answering it. So a *statement* post was captured instead:
  "Playwright is significantly better than Selenium", r/softwaretesting, 25
  comments for one ScrapeCreators credit. Four are asking. One is the shape
  this product exists to find — a person testing a native Android app who says
  so and asks for alternatives.

  `capture:comment-filter statement-post`, two calls, against
  `openai/text-embedding-3-small`. The parent title alone scores 0.3892.

  | | Comment alone | Under the parent title |
  |---|---|---|
  | Range | 0.0457 to 0.5681 | 0.3174 to 0.5270 |
  | Kept at 0.15 | 19 of 25 | 25 of 25 |
  | Asking against answering | no threshold separates them | no threshold separates them |
  | About testing against not | no threshold separates them | no threshold separates them |

  **The comparison the first run could not make now says the same thing.** The
  highest similarity in the thread, 0.5681, is an expert answering about Safari
  and WebKit. The real asker is seventh at 0.4377, and two more askers sit at
  0.1898 and 0.1215. A threshold tuned to keep the asker keeps six people
  answering above it.

  Two facts harden the decision rather than merely repeating it. At the shipped
  threshold of 0.15 the comment-alone setting **drops an asking comment**, the
  0.1215 one, which is exactly the invisible false negative this stage was
  suspected of and the first thread could not demonstrate. And thread one's
  0.0103 subject gap **did not reproduce**: here the lowest topical comment is
  0.1215 against an off-topic 0.2688, so subject is not separated at any
  tuning. That gap was noise measured on one thread, not a narrow signal.

  The instrument now takes a thread name and defaults to the first, so the
  committed numbers of 09:24 still reproduce. The ticket stays closed: its
  conclusion is unchanged and this is the evidence it asked for.

