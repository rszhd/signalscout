---
id: US-400
title: A post written twice is one card
type: feature
priority: p1
created: 2026-09-24T23:37+08:00
parent:
area:
resolution:
---

## Context

**One question put to two subreddits made two cards.** Deduplication is
`UNIQUE (source, external_id)`, and a post the author writes again gets a new
id. So each copy was scored, paid for and shown on its own card, and a person
read the same post twice and could answer it twice. The owner asked for one
card: the same user posting the same thing in two subreddits.

**What counts as a copy.** The same platform, the same author, the same words,
and at most seven days apart — the owner's number. "The same words" is
`posts.text_fingerprint`, which Postgres computes from the title and the
excerpt in lower case with whitespace collapsed. An edited copy is not caught,
on purpose: a false merge hides a lead, a missed one costs a card. The
subreddit is not part of the key, so a repost in the same subreddit is a copy
too. Replies are never copies: "same here" is the same words from many people.

**A copy is skipped only when its group already has a card.** The first design
skipped every copy of a post this monitor had scored. Measured on the stored
data before it shipped, that would have hidden leads: the model's score varies
between identical posts, and in 3 of 24 copies the original scored below the
threshold while the copy cleared it — once 72 where the original did not reach
30, same words, same subreddit. So a copy of a post below the threshold is
still scored, and if it makes a card, the earlier copies go on that card.

**Per monitor.** A post is shared and a card is one monitor's. A monitor that
never met the first copy scores the second as a post of its own. Two projects
may each show the same post; the owner said that is fine.

## Acceptance

- [x] `posts.text_fingerprint` is a generated column with an index on
      `(source, author, text_fingerprint)`, and `post_copies` records which
      card shows a copy, per monitor (migration 0071)
- [x] The classify step does not score a post whose earlier or later copy
      within seven days already has a card on this monitor; it records the
      copy on that card. It reads the batch in the order it was handed, which
      the daily ceiling depends on
- [x] A copy of a post that scored below the threshold is scored, and if it
      makes a card, the copies scored before it are put on that card
- [x] Replies, posts with no author, edited words, another author and copies
      more than seven days apart are scored as posts of their own
- [x] A copy handed back by a later poll is not asked about again
- [x] The inbox read, the API and the CSV carry each card's copies, oldest
      first, without a deleted one; the reading pane links them under
      *Also posted in*
- [x] The classify step's history counts the copies it did not score
- [x] `docs/pipeline.md` and the site's inbox page describe it

## Notes

- `worker/classify.ts` holds the rule; `copyWindowDays` is the seven days.
- The paid measurement loop in `docs/instruments.md` was not run: it captures
  the triage and classifier prompts on fixed samples, and this change moves
  neither, so it would repeat the last numbers. The change was measured on the
  stored data instead, with the query in the Log.
- Existing duplicate cards stay as they are: their verdicts and marks are a
  person's, and merging them would have to choose between two. New copies land
  on the oldest card of their group.
- Known limit: when the post that holds the card is deleted, its match is
  hidden (US-015) and a live copy stays on it rather than becoming a card.

## Log

- 2026-09-24T23:37+08:00 — Measured on the local stored data (4,812 scored
  monitor–post pairs): 24 copies had been scored a second time, 7 of them in
  another subreddit, for 3 cents of model calls, and 11 had made cards of
  their own. Under the first design 3 of those 24 would have been hidden
  leads, so the rule changed to the one in Context. Under it, 8 copies are not
  scored and 8 duplicate cards go; 16 are still scored, and 3 of them make the
  one card for their group. No lead is hidden by construction.
- 2026-09-24T23:43+08:00 — The first build sorted each batch oldest first, so the first copy
  would be the card. The ceiling tests caught that this reordered the batch
  the daily ceiling reads, which would have read stale posts and dropped the
  newest. The batch keeps its handed order; the first copy reached is scored.
  The full suite passes (2,530 tests), with lint and typecheck. The reading
  pane's line is covered by the UI tests and was not rendered in a browser.
