---
id: US-029
title: A measurement says which pre-filter fits a comment
type: spike
priority: p2
created: 2026-09-06T01:32+08:00
parent: US-020
area:
resolution:
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

- [ ] The 21 comments in the captured thread are labelled by hand as asking or
      answering, and the labels are committed beside the fixture
- [ ] Each comment is embedded three ways against PLAN.md's example monitor —
      alone, with the parent title prepended, and the parent title alone as the
      baseline — and the similarities are recorded
- [ ] The similarities are committed, not the vectors, for the reason
      `capture:embeddings` already gives
- [ ] The measurement runs from one script, named in `package.json` beside the
      other instruments, and the Log records what it cost
- [ ] The Log says whether any threshold separates asking from answering, in
      either embedding mode, and names the threshold or says that none exists
- [ ] The Log says what the same threshold does to the labelled comments at
      `defaultSimilarityThreshold`, which is 0.15 today
- [ ] US-020 and US-030 are updated with the answer: the embedding stage runs
      on comments, or it does not

## Notes

- Depends on nothing. It reads a committed fixture.
- Blocks the stage-order decision in [US-020](US-020-a-monitor-can-include-reddit-comments.md)
  and [US-030](US-030-a-cheap-model-decides-which-comments-the-good-model-reads.md).
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
