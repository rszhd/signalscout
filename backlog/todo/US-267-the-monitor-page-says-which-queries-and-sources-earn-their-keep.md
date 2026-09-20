---
id: US-267
title: The monitor page says which queries and sources earn their keep
type: feature
priority: p2
created: 2026-09-20T09:08+08:00
parent:
area: web
resolution:
---

## Context

A person sets a monitor up once and then has no way to improve it. They
wrote the answers, a model turned them into a search plan, and from then on
the plan is a black box that fills an inbox or does not. On a self-hosted
instance a phrase that never matches pays into both the source bill and the
model bill for nothing, and the person paying cannot see which phrase.

Three readings answer it, and every one is computed from rows this
application already holds:

- **What each query found.** US-212 records the query that found a post,
  and `queryPerformance` in the package ranks a monitor's inputs by posts
  found, matches made, best score and last hit. Nothing here calls it.
- **Where the matches come from.** Per platform and per channel, count and
  average score. On the cloud instance this read added a source and dropped
  the weakest subreddit.
- **Posts against comments.** Reading threads is the expensive stage and the
  obvious thing to switch off to save money. On the cloud instance comments
  averaged 64 against 48 for posts: the number that reverses an instinct.

**The floor travels with the answer.** Every count uses the monitor's
`min_score` and every screen says so, so a statistic can be reproduced. The
hosted application learned this as US-219 there, when a monitor page said 44
matches beside an inbox that showed 12. Nothing is deleted: the weak rows are
the evidence for the threshold.

The hosted application built these as US-213 and US-214.

## Acceptance

- [ ] `GET /api/monitors/:id/queries` returns each query and subreddit with
      posts found, matches at or above the monitor's threshold, best score,
      and last found; the floor is in the response.
- [ ] `GET /api/monitors/:id/leads` returns matches by platform, by channel,
      posts against comments, and the intent mix, each with count and
      average score, all at the same floor.
- [ ] Tests scope both reads to the owner and prove the floor: a match
      under `min_score` is not counted.
- [ ] The monitor page shows both, and each heading names the floor.
- [ ] A query with no match in thirty days is marked so a person can see
      what to remove.
- [ ] The monitor page's match count uses the same floor as the two new
      sections; a test proves the three agree.

## Notes

- `packages/pipeline/src/index.ts:269` — `queryPerformance`;
  `packages/pipeline/src/monitors/query-performance.ts`.
- `packages/pipeline/src/db/schema/posts.ts:302` — `discoveryKinds`.
- Cloud repository: `apps/api/src/monitors/detail.ts` (`/queries`),
  `apps/api/src/leads.ts`, and US-215 for the picture it did not draw.
- Depends on US-264 so the floor is visible where it is applied.

## Log

- 2026-09-20T09:08+08:00 — Written from the cross-repository review of the
  cloud's changes since the split.
