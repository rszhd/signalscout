---
id: US-139
title: Bright Data reads the comments under a Reddit post
type: feature
priority: p3
created: 2026-09-15T14:02+08:00
parent: US-020
area:
resolution:
---

## Context

**Bright Data has a Reddit comments dataset and nobody has read its price.**
US-020's Notes say so, and say not to fill the number in from the posts
dataset, which is $1.50 per thousand records. `brightdata/client.ts` already
addresses a scraper by dataset id and notes that posts and comments are two
datasets.

**Every call at this provider is a trigger and then a snapshot poll**, and a
collection took 8 minutes 40 seconds one day and 2 minutes 13 the next. A
thread walk that opens twenty-five threads a poll is twenty-five snapshots, or
one snapshot with twenty-five inputs if the dataset accepts a batch. Which of
those the dataset does is the first question the capture asks, because the
answer decides whether this connector can read threads inside a poll at all.

**This is the last of the five and the least used.** US-134 excludes Bright
Data from the lent-keys plan on price. An account with its own Bright Data key
can already read Reddit threads by adding a ScrapeCreators key beside it,
which the form suggests. The reason to build it is completeness: the owner
asked for comments on every connector.

## Acceptance

- [ ] The comments dataset's price is read from the provider and recorded in
      docs/costs.md and docs/sources.md, and `replyPricePerUnitMicros` carries
      it
- [ ] The capture answers whether one snapshot takes many post URLs, and the
      connector reads threads in one snapshot per poll if it does
- [ ] `fetchReplies` triggers, polls and reads the snapshot the way `search`
      does, within the same deadline
- [ ] A reply's id is Reddit's `t1_` fullname, so it deduplicates against the
      same comment through ScrapeCreators — the rule both Reddit post
      connectors already keep for `t3_`
- [ ] A permalink is read from the record, and one was opened in a browser
      and reached the comment
- [ ] The parser replays a captured fixture from `brightdata/fixtures/capture.mjs`,
      extended with a comments mode. Price unknown until the first box is done
- [ ] The monitor form's per-platform reply note reads the new declaration
- [ ] No test spends money

## Notes

- Needs `BRIGHTDATA_API_KEY` in `.env`. It is not on the development machine
  on the day this was written.
- If the dataset takes one URL per snapshot and a snapshot takes minutes,
  say so here and stop. A thread walk that cannot finish inside a poll is not
  a feature.

## Log

- 2026-09-15T14:02+08:00 — Written. Fifth of five; blocked on a key and on a
  price.
