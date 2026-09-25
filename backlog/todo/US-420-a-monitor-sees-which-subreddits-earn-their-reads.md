---
id: US-420
title: A monitor sees which subreddits earn their reads
type: feature
priority: p2
created: 2026-09-26T02:07+08:00
parent: US-035
area: pipeline
resolution:
---

## Context

**Radar found the right subreddit worth more than any phrase.** In subreddits
made for buying advice, 63–95% of posts asked for a product; a keyword search
gave 7–8%. A subreddit read also returned about 23 posts per credit against 7
for a search (signalscout-radar, 2026-09-26 probes).

**In SignalScout the subreddits are the weakest input and the least
examined.** The query generator names them from memory (US-035 says so), and a
person sees no number that says whether one earns its reads. `post_discoveries`
already records the subreddit behind every post (US-212), so the number exists;
it is not shown or used.

## Acceptance

- [ ] Query performance lists each subreddit beside the phrases, with posts,
      matches and (after US-419) cost
- [ ] A subreddit with many posts and no match over a week is marked as a
      candidate to remove
- [ ] The Log records, for the live monitors, what share of matches came from
      subreddits against phrases

## Notes

- Depends on US-419 for the cost column.
- US-035 is the other half: finding better subreddits to add.

## Log
