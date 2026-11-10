---
id: US-557
title: Facebook posts are found by keyword, through Google
type: feature
priority: p1
created: 2026-11-10T13:29+08:00
parent: US-516
area: engine
resolution:
---

## Context

The Facebook connector reads only groups it is given by address (US-516). An
application must know the groups first, and BuyerFinder kept a hand-judged
list of about 180 for that. Tests on 2026-11-10 showed the list misses most of
the conversation: a Google search of `<phrase> site:facebook.com/groups`
limited to the past 24 hours returned about 30 group posts a phrase, from 13
to 26 groups, and only 1 to 3 of those groups were on the list.

The owner decided on 2026-11-10 that BuyerFinder and Radar stop reading the
known list. Facebook is found two ways, as Reddit is: by keyword, and by the
groups a person names. This ticket is the engine half.

What was measured on 2026-11-10, through the ScrapeCreators key we already
hold:

- `GET /v1/google/search` with `query`, `date_posted=last-day` and `page`
  answers 10 results a request, 1 credit, in 3 to 6 seconds. Every result was
  a group post link (`/groups/<group>/posts/<id>/`). Each `description` began
  with the post's age ("8 hours ago"); all 50 results were 4 to 23 hours old.
  The answer names `next_page`; pages run 1 to 11.
- Google shows a post 4 to 23 hours after it is written, so a `last-hour`
  search would miss most posts. A poll asks for the past day and drops what it
  has seen.
- `GET /v1/facebook/post?url=` reads one group post found this way: 1 credit,
  full text, `creation_time`, author, the first comments. Its `post_id` is the
  number in the URL, which is the `id` a group read returns, so one post found
  both ways is one post.
- A result holds a title and about 150 characters. With the phrases
  BuyerFinder writes for Reddit, most results were sale listings ("Dometic
  CFX-40W for sale"); buyer questions were 0 to 5 in 20. Adding "recommend"
  or an OR list of intent words did not change that. So a full read for every
  result pays mostly for listings.

## Acceptance

- [x] The Facebook connector declares `discovery: ["keyword", "channel"]`. A query that is a group's address is read as today; any other query is a phrase and is searched (see Notes for why not `channels`).
- [x] A phrase poll searches `<phrase> site:facebook.com/groups` in the smallest window covering `since` (past day for an hourly monitor), and reads `pagesPerPhrase` pages (default 2, at most 11), or fewer when Google has no next page. Google ranks by relevance, so no page can end the read early.
- [x] A result becomes a partial post with its numeric post id as `externalId`, the group key as its channel, and an approximate `postedAt` from the stated age. A result whose age or address cannot be read is dropped.
- [x] Only a post the filter keeps is read in full through `/v1/facebook/post`, by `completePosts`, the step forum feeds already use (US-476).
- [x] A post found by phrase and by its group has the same `externalId`, so it is stored and billed once.
- [x] Every request's credits reach `unitsConsumed`; the price per unit stays the key's.
- [x] Fixtures are captured from the provider, not written: two search pages, an empty search, one post read, one unknown post.
- [x] `docs/sources.md` and the site's keys page describe the two ways.
- [ ] Released, with the owner's yes.

## Notes

- **Why a query's form, not `channels`.** The pipeline fills `channels` from `generatedSubreddits`, for Reddit only. Moving groups there needed a per-platform channel column, a form change and a data move in two applications. A group address and a phrase cannot be mistaken for each other, so the connector tells them apart and nothing stored changes. `acceptsPhrases` on the platform's search style lets a person write either; the model is still asked for addresses.
- The group's name is in neither answer. A name costs 1 credit through `/v1/facebook/group`; each application decides whether to pay it once per new group.
- Test scripts and raw answers from 2026-11-10 lived in that session's scratchpad (`sc-google-test.mjs`, `sc-post-test.mjs`).

## Log

- 2026-11-10T13:29+08:00 — Written after the owner's decision and the tests above.
- 2026-11-10T13:55+08:00 — Built. `capture-search.mjs` spent 3 credits on its final run (two search pages 1 each, the post read 1, the empty search and the unknown post 0). Its first run kept commenters' names in Google's snippets ("<name> ▻ <group>"), so the scrubber now keeps only a snippet's age label and the capture was run again; that first run spent 5 credits. Page 2 repeated one post of page 1. Engine suite 1,040 tests, full suite 2,881, lint and typecheck clean.
